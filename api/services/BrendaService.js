//
// BrendaService.js - in api/services
//

var fs = require('fs');
var path = require('path');

module.exports = {

	getBrendaVersion: function(){

		var promise = new sails.RSVP.Promise( function(fullfill, reject) {

			var setupFileLocation = "";
			if ( !sails.config.brenda.settings.setupFileLocation || sails.config.brenda.settings.setupFileLocation == "" ) {
				setupFileLocation = sails.config.brenda.settings.setupFileLocation;
			} else {
				setupFileLocation = "lib/brenda/setup.py";
			}

			fs.exists(setupFileLocation, function (exists) {
				if (exists) {
					fs.readFile(setupFileLocation, {encoding: 'utf-8'}, function (err, data) {
						if (!err) {
							var match = data.match(/VERSION="([0-9].*)"/);
							if(match[1] != undefined && match[1] != ""){
								fullfill( match[1] );
							} else {
								reject( new Error("Unable to find the version in the file provided.") );
							}

						} else {
							reject( new Error(err) );
						}
					});
				} else {
					reject( new Error("Unable to find the Brenda setup file: " + setupFileLocation) );
				}
			});

		});

		return promise;
	},


	applyAmazonS3Config: function(){

		//TODO: Make the path a variable that can be updated via the settings for PC users.
		fs.readFile('~/.aws/credentials', 'utf8', function (err,data) {
			if (err) {
				return sails.log(err);
			}
			sails.log(data);
		});
	}
}