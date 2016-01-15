var debug     = require('debug')('metalsmith-convert'),
    path      = require('path'),
    minimatch = require('minimatch'),
    sizeOf    = require("image-size"),
    gm        = require("gm"),
    jsAsync   = require("async"),
    util      = require('util');

module.exports = convert;

function convert(options) {
  return function(files, metalsmith, done) {
    var results = {}; // don't process results of previous passes
    var pass = function(args) {
      return function(callback) {
        var ret;
        if (!args.src && !args.target) {
          ret = new Error('metalsmith-convert-gm: "src" and "target" args required');
          callback(ret);
          return;
        }

        if (!args.nameFormat) {
          if (args.resize) {
            args.nameFormat = '%b_%x_%y%e';
          } else {
            args.nameFormat = '%b%e';
          }
        }
        var ext = args.extension || '.' + args.target;
        var convertFileFunctions = Object.keys(files).map(function (file) {
          return convertFile(file, ext, args, files, results);
        });
        jsAsync.parallel(convertFileFunctions, function(err) {
          if (err) {
            ret = new Error('metalsmith-convert-gm: encountered error while converting image: ' + err);
          }
          callback(ret);
        });
      };
    };
    if (util.isArray(options)) {
      var passFunctions = options.map(pass);
      jsAsync.parallel(passFunctions, function(err) {
        done(err);
      });
    } else {
      pass(options)(function(err) {
        done(err);
      });
    }
  };
}

function convertFile(file, ext, args, files, results) {
  return function (callback) {
    var nameData = {'%e': ext};
    if (minimatch(file, args.src)) {
      if (results[file]) return;

      var imageSettings = {
        srcData: files[file].contents,
        format: args.target,
        resizeStyle: undefined
      };
      var passes = {
        quality: 90
      };
      var currentExt = path.extname(file);
      nameData['%b'] = path.basename(file, currentExt);

      // Pass options to imagemagick-native
      [
        'density',
        'blur',
        'rotate',
        'flip',
        'quality',
        'trim',
        'crop'
      ].forEach(function (setting) {
        if (args.hasOwnProperty(setting)) {
          passes[setting] = args[setting];
        }
      });


      var gmStream = gm(imageSettings.srcData);
      if (args.resize) {
        debug("Resizing (" + args.resize.width + "x" + args.resize.height + ")");
        gmStream = gmStream.resize(args.resize.width, args.resize.height, args.resize.resizeStyle);
      }
      Object.keys(passes).forEach(function (pass) {
        if (passes.hasOwnProperty(pass) && (passes[pass] !== undefined || passes[pass] !== null)) {
          if (util.isArray(passes[pass])) {
            gmStream = gmStream[pass](...passes[pass]);
          } else {
            gmStream = gmStream[pass](passes[pass]);
          }
        }
      });
      gmStream.toBuffer(imageSettings.format, function(err, buffer) {
        if (err) {
          callback(err, null);
          return;
        }
        var imgSize = sizeOf(buffer);
        if (args.resize) {
          nameData['%x'] = args.resize.width;
          nameData['%y'] = args.resize.height;
        } else {
          nameData['%x'] = imgSize.width;
          nameData['%y'] = imgSize.height;
        }
        var newName = assembleFilename(args.nameFormat, nameData);
        debug("New name is " + newName);
        newName = path.join(path.dirname(file), newName);

        var origImgSize = sizeOf(imageSettings.srcData);
        files[file].imageSize = {width: origImgSize.width, height: origImgSize.height};
        files[newName] = {
          contents: buffer,
          imageSize: {width: imgSize.width, height: imgSize.height}
        };
        results[newName] = true;
        if (args.remove) {
          delete files[file];
        }
        callback(err, null);
      });
    } else {
      callback();
    }
  };
}

function assembleFilename(format, data) {
  var result = format;
  for(var key in data) {
    debug("Replacing " + key + " with " + data[key]);
    result = result.replace(key, data[key]);
  }
  return result;
}
