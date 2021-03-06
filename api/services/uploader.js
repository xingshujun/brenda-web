/**
 * FileController
 *
 * @description :: Server-side logic for managing files
 * @help        :: See http://links.sailsjs.org/docs/controllers
 */
var path = require('path'),
	fs = require('fs'),
	AWS = require('aws-sdk'),
	zlib = require('zlib'),
	s3Stream = require('s3-upload-stream')(new AWS.S3());

module.exports = {

	/**
	*
	* Handles validating the files uploaded
	* @param fileStream: object - File stream from the upload
	* @param allowedExtensions: array - An array of extensions to validated based on. Be sure to include the '.' e.g, .blend in the extension.
	* @param maxBytes: integer - The maximum number of bytes to allow
	* @return object
	**/
	validate: function(fileStream, allowedExtensions, maxBytes){

		sails.log('Validating file...');

		if(typeof allowedExtensions === 'undefined') {
			allowedExtensions = ['.zip','.gz','.gzip'];
		}

		var upload = fileStream,
			headers = upload.headers,
			byteCount = upload.byteCount,
			filename = upload.filename,
			extension = path.extname(filename),
			validated = true,
			fileParams = {},
			settings = {
				allowedTypes: [
					'application/zip',
					'application/octet-stream',
					'application/x-gzip',
					'multipart/x-gzip',
					'multipart/x-zip',
					'application/blender'
				],
				maxBytes: 100 * 1024 * 1024
			};

		if(typeof maxBytes !== 'undefined'){
			settings.maxBytes = maxBytes;
		}

		var errors = [];

		var projectTmpFolder = path.join(process.cwd(), '.tmp', 'uploads');
		var tmpPath = sails.os.tmpdir();

		var filenameWithoutExt = filename.replace(extension, '');
		var destPath = path.join(projectTmpFolder);
		//var destPathWithFilename = path.join(projectTmpFolder, filenameWithoutExt + '.gz');
		//var outputZipFilename = filenameWithoutExt + '.gz';

		sails.log('Project tmp: ' + projectTmpFolder);
		sails.log('OS tmp: ' + tmpPath);
		sails.log("Filename w/o ext: " + filenameWithoutExt);
		//sails.log.info("Destination path w/Filename: " + destPathWithFilename);
		//sails.log.info("Destination path: " + destPath);

		// Check file type
		if (_.indexOf(settings.allowedTypes, headers['content-type']) === -1) {
			validated = false;
			errors.push({message: 'Wrong filetype (' + headers['content-type'] + ').'});
		}
		// Check file size
		if (byteCount > settings.maxBytes) {
			validated = false;
			errors.push({message: 'Filesize exceeded: ' + byteCount + '/' + settings.maxBytes + '.'});
		}

		return errors;
	},

	/**
	*
	* Creates a zip file and uploads the file to Amazon S3
	* @param fileStream: object - The upload file stream
	* @param bucket: string - The Amazon S3 bucket to upload to
	* @return promise
	**/
	createZipAndUploadToS3: function(fileStream, bucket){
		var promise = new sails.RSVP.Promise( function(fulfill, reject) {

			if(typeof fileStream === 'undefined'){
				reject('fileStream is not defined');
			}

			var filename = fileStream.filename,
				extension = path.extname(filename),
				filenameNoExt = filename.replace(extension, '');

			var readStream = fileStream;

			//Update the credentials with the local ones
			AWS.config.update(sails.config.aws.credentials);

			var s3Stream = require('s3-upload-stream')(new AWS.S3());

			var s3UploadStream = s3Stream.upload({
							Bucket: bucket,
							Key: filenameNoExt + '.gz', //filename
							ACL: "authenticated-read",
							StorageClass: "REDUCED_REDUNDANCY"
						});

			var compress = zlib.createGzip();

			// Optional configuration
			//s3UploadStream.maxPartSize(20971520); // 20 MB
			//s3UploadStream.concurrentParts(5);

			// Handle errors.
			// TODO: JSON.parse doesn't seem to be working on this error.
			//     	 I can't figure out how to get the freaking message from the error.
			s3UploadStream.on('error', function (err) {
				err = err.replace(err.substr(0,42), '');
				err = JSON.parse(err);
				/*
				[ 'Failed to create a multipart upload on S3',
				  ' {"message"',
			`		  '"Inaccessible host',
				  ' `s3-us-west-2.amazonaws.com\'. This service may not be available in the `us-west-2\' region.","code"',
				  '"UnknownEndpoint","region"',
				  '"us-west-2","hostname"',
				  '"s3-us-west-2.amazonaws.com","retryable"',
				  'true,"originalError"',
				  '{"message"',
				  '"getaddrinfo ENOTFOUND s3-us-west-2.amazonaws.com","code"',
				  '"NetworkingError","errno"',
				  '"ENOTFOUND","syscall"',
				  '"getaddrinfo","hostname"',
				  '"s3-us-west-2.amazonaws.com","region"',
				  '"us-west-2","retryable"',
				  'true,"time"',
				  '"2015-06-01T18',
				  '46',
				  '20.737Z"},"time"',
				  '"2015-06-01T18',
				  '46',
				  '20.737Z"}' ]
				  */
				//sails.log.error(err);
				reject(err);
			});

			/* Handle progress. Example details object:
			   { ETag: '"f9ef956c83756a80ad62f54ae5e7d34b"',
			     PartNumber: 5,
			     receivedSize: 29671068,
			     uploadedSize: 29671068 }
			*/
			s3UploadStream.on('part', function (details) {
				sails.log(details);
			});

			/* Handle upload completion. Example details object:
			   { Location: 'https://bucketName.s3.amazonaws.com/filename.ext',
			     Bucket: 'bucketName',
			     Key: 'filename.ext',
			     ETag: '"bf2acbedf84207d696c8da7dbb205b9f-5"' }
			*/
			s3UploadStream.on('uploaded', function (details) {
				sails.log(details);

				//Delete the temporary file
				/*fs.unlink(targetPathWithFilename, function(err){
					if(err){
						sails.log.error(err);
						reject(err);
					} else {
						fulfill( 'Deleted the temporary file after writing ' + archive.pointer() + ' bytes.' );
					};
				});*/

				//fulfill the promise
				fulfill(details);
			});

			//Kick off the process
			readStream.pipe(compress).pipe(s3UploadStream);

		});
		return promise;
	},

	/**
	*
	* Creates a upload record in the database
	* @param upload: array The file that was uploaded.
	* @param aws_data: object The Amazon S3 data object from s3-upload-stream
	* @return promise
	**/
	createFileRecord: function(user_id, upload, aws_data){
		var promise = new sails.RSVP.Promise( function(fulfill, reject) {
			if(!user_id){
				sails.log.error("You must provide a user id.");
				reject("You must provide a user id.");
			}
			if(!upload){
				sails.log.error("You must provide a valid upload record.");
				reject("You must provide a valid upload record.");
			}
			if(aws_data.length < 1){
				sails.log.error("Not a valid s3-upload-stream return object.");
				reject("Not a valid s3-upload-stream return object.");
			}
			var uploadParams = {};

			if(typeof upload.fd !== 'undefined'){
				uploadParams = {
					uploadName: aws_data.Key.split('/').pop().split('.').shift(),
					extension: path.extname(aws_data.Key),
					originalName: upload.fd.uploadname,
					contentType: upload.type,
					uploadSize: upload.size,
					aws_s3_location: aws_data.Location,
					aws_s3_bucket: aws_data.Bucket,
					aws_s3_etag: aws_data.ETag.replace(/['"]+/g, ''),
					uploadedBy: user_id
				};
			} else if(typeof upload.uploadname !== 'undefined'){
				uploadParams = {
					uploadName: aws_data.Key.split('/').pop().split('.').shift(),
					extension: path.extname(aws_data.Key),
					originalName: upload.uploadname,
					contentType: upload.headers['content-type'],
					uploadSize: upload.byteCount,
					aws_s3_location: aws_data.Location,
					aws_s3_bucket: aws_data.Bucket,
					aws_s3_etag: aws_data.ETag.replace(/['"]+/g, ''),
					uploadedBy: user_id
				};
			}else {
				reject('Unable to parse the upload.');
			}

			sails.log(uploadParams);

			// Create a Upload model.
			Upload.create(fileParams, function(err, newUpload) {
				if (err) {
					reject(err);
				}
				fulfill(newUpload);
			});
		});
		return promise;
	},

	/**
	 * `UploadController.upload()`
	 *
	 * Upload file(s) to the server's disk.
	 */
	upload: function (req, res) {

		var promise = new sails.RSVP.Promise( function(fulfill, reject) {
			// e.g.
			// 0 => infinite
			// 240000 => 4 minutes (240,000 miliseconds)
			// etc.
			//
			// Node defaults to 2 minutes.
			res.setTimeout(0);
			req.file('files[]')
			.upload({
				// You can apply a file upload limit (in bytes)
				maxBytes: 1000000,
				dirname: path.resolve('', 'files/projects')
			}, function whenDone(err, uploadedFiles) {

				var filenameContainer = uploadedFiles[0].fd.split('/')
							 filename = filenameContainer[filenameContainer.length - 1 ];
						 filelocation = '/projects/' + filename;

				sails.log(filename);
				var temp = {};
				temp.files = [{
						"name": uploadedFiles.filename,
						"size": uploadedFiles.size,
						"url": filelocation,
						"thumbnailUrl": filelocation
					}];

				sails.log(uploadedFiles);
				if (err) {
					reject(err);
				} else {
					fulfill(temp);
				}
			});
		});
		return promise;
	},

	/**
	 * `UploadController.s3upload()`
	 *
	 * Upload file(s) to an S3 bucket.
	 *
	 * NOTE:
	 * If this is a really big file, you'll want to change
	 * the TCP connection timeout.  This is demonstrated as the
	 * first line of the action below.
	 */
	s3upload: function (req, res, bucket, acl) {

		var promise = new sails.RSVP.Promise( function(fulfill, reject) {
			if(!acl) acl = 'public-read';

			console.log(req.file('filedata'));
			// e.g.
			// 0 => infinite
			// 240000 => 4 minutes (240,000 miliseconds)
			// etc.
			//
			// Node defaults to 2 minutes.
			res.setTimeout(0);

			var errors = [];
			if(!sails.config.aws.credentials.accessKeyId){
				errors.push({message: 'You must provide a valid AWS access key.'});
			}
			if(!sails.config.aws.credentials.secretAccessKey){
				errors.push({message: 'You must provide a valid AWS secret access key.'});
			}
			if(!settings.aws_s3_project_bucket){
				errors.push({message: 'You have not configured an AWS S3 project bucket. Do this on the <a href="/settings">settings page</a>.'});
			}
			if(errors.length > 0){
				reject(errors);
			}

			req.file('filedata').upload({
				adapter: require('skipper-s3-alt'),
				fileACL: acl,
				bucket: bucket,
				key: sails.config.aws.credentials.accessKeyId,
				secret: sails.config.aws.credentials.secretAccessKey
			}, function whenDone(err, uploadedFiles) {
				if (err) {
					reject(err);
				} else {
					fulfill(uploadedFiles);
				}
			});
		});
		return promise;
	},


	/**
	 * UploadController.download()
	 *
	 * Download a file from the server's disk.
	 */
	download: function (req, res) {
		require('fs').createReadStream(req.param('path'))
		.on('error', function (err) {
			return res.serverError(err);
		})
		.pipe(res);
	}
};