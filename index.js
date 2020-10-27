const cron = require("node-cron");
const os = require('os');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
let shell = require("shelljs");
let nodemailer = require("nodemailer");

const PLUGIN_ID = 'signalk-scheduler'
const PLUGIN_NAME = 'Scheduler'

const JOBTYPES = ["Shell", "SignalK Put", "SignalK Backup"];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BACKUP_EXTENSION = '.backup';

module.exports = function(app) {
  var plugin = {};
  var jobOptions = {};
  var jobsTracker = {};

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = 'Cron like scheduler for SignalK. It can execute shell commands and SignalK puts (like turning on a switch) at a prescibed time and day(s)';

  plugin.schema = {
    "type": "object",
    "properties": {
      "mail": {
        "type": "object",
        "title": "eMail Config",
        "properties": {
          "host": {
            "type": "string",
            "title": "Host"
          },
          "port": {
            "type": "number",
            "title": "Port"
          },
          "secure": {
            "title": "Secure",
            "type": "boolean",
            "default": false
          },
          "username": {
            "type": "string",
            "title": "Username"
          },
          "password": {
            "type": "string",
            "format": "password",
            "title": "Password"
          },
          "fromEmail": {
            "type": "string",
            "title": "From Address"
          }
        }
      },
      "job": {
        "type": "array",
        "title": "Job",
        "items": {
          "type": "object",
          "required": [

          ],
          "properties": {
            "name": {
              "type": "string",
              "title": "Job Name"
            },
            "enabled": {
              "type": "boolean",
              "title": "Enabled"
            },
            "sendEmail": {
              "type": "boolean",
              "title": "Send Email"
            },
            "time": {
              "type": "string",
              "title": "Time (24hr)",
              "pattern": "^[0-2]\\d:[0-5]\\d$"
            },
            "days": {
              "type": "array",
              "title": "Days",
              "items": {
                "type": "string",
                "enum": [
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                  "Sunday"
                ]
              },
              "minItems": 1,
              "maxItems": 7,
              "uniqueItems": true
            },
            "commandType": {
              "type": "string",
              "title": "Command Type",
              "enum": [
                "Shell",
                "SignalK Put",
                "SignalK Backup"
              ]
            }
          },
          "dependencies": {
            "commandType": {
              "oneOf": [{
                  "properties": {
                    "commandType": {
                      "enum": [
                        "Shell"
                      ]
                    },
                    "command": {
                      "type": "string",
                      "title": "Shell Command",
                      "description": "The command to be executed via sh (linux) or cmd.exe (windows)."
                    }
                  }
                },
                {
                  "properties": {
                    "commandType": {
                      "enum": [
                        "SignalK Put"
                      ]
                    },
                    "path": {
                      "type": "string",
                      "title": "SignalK Path"
                    },
                    "value": {
                      "type": "string",
                      "title": "Value"
                    }
                  }
                }, {
                  "properties": {
                    "commandType": {
                      "enum": [
                        "SignalK Backup"
                      ]
                    },
                    "backupPath": {
                      "type": "string",
                      "title": "Backup Location",
                      "description": "The location that backups should be stored."
                    },
                    "includePlugins": {
                      "type": "boolean",
                      "title": "Include Plugins",
                      "description": "Selecting Yes will increase the size of the backup, but will allow for offline restore.",
                      "default": false
                    },
                    "cleanup": {
                      "type": "boolean",
                      "title": "Cleanup Old files",
                      "description": "Selecting Yes will delete old backup files.",
                      "default": false
                    },
                    "numBackups": {
                      "type": "number",
                      "title": "Number of Backups to Keep.",
                      "description": "The number of backups to be kept. All other backup files will be removed."
                    }
                  }
                }
              ]
            },
            "sendEmail": {
              "oneOf": [{
                "properties": {
                  "sendEmail": {
                    "enum": [
                      true
                    ]
                  },
                  "toEmail": {
                    "type": "string",
                    "title": 'Send Email To Address(es)',
                    "description": 'Comma separated list of recipients email addresses',
                  }
                }
              }]
            }
          }
        }
      }
    }
  }

  plugin.start = function(options, restartPlugin) {
    app.debug('Plugin started');
    jobsTracker = {};
    jobOptions = options;

    for (var jobName in options.job) {
      let job = options.job[jobName];

      createJob(job);
    }
  };

  plugin.stop = function() {
    // Here we put logic we need when the plugin stops
    app.debug('Plugin stopped');
    Object.keys(jobsTracker).forEach(key => {
      jobsTracker[key].destroy()
    });
  };

  plugin.registerWithRouter = function(router) {
    router.get("/jobs", (req, res) => {
      res.json(Object.keys(jobsTracker));
    })

    router.get("/jobs/:jobid", (req, res) => {
      let jobid = req.params.jobid;
      let job = jobOptions.job.find(job => job.name === jobid);

      if (!job) {
        let msg = 'No job found for ' + jobid
        app.debug(msg)
        res.status(400)
        res.send(msg)
        return
      }

      job.isRunning = jobsTracker[jobid].hasOwnProperty('running') ? jobsTracker[jobid].running : false;
      job.status = jobsTracker[jobid].getStatus() || 'not scheduled';
      res.json(job);
    })

    router.put("/jobs/:jobid/start", (req, res) => {
      let jobid = req.params.jobid;
      let job = jobsTracker[jobid];

      if (!job) {
        let msg = 'No job found for ' + jobid
        app.debug(msg)
        res.status(400)
        res.send(msg)
        return
      }

      //enable job from the config
      let obj = jobOptions.job.find(f => f.name === jobid);
      if (obj) {
        obj.enabled = true;
      }

      let state = saveOptions(jobOptions);
      if (state != 'SUCCESS') {
        let msg = 'Could not save options.';
        app.debug(msg);
        res.status(500);
        res.send(msg);
        return;
      }

      job.start();
      res.json({
        status: job.getStatus()
      });
    })

    router.put("/jobs/:jobid/stop", (req, res) => {
      let jobid = req.params.jobid;
      let job = jobsTracker[jobid];

      if (!job) {
        let msg = 'No job found for ' + jobid
        app.debug(msg)
        res.status(400)
        res.send(msg)
        return
      }

      //disable job from the config
      let obj = jobOptions.job.find(f => f.name === jobid);
      if (obj) {
        obj.enabled = false;
      }

      let state = saveOptions(jobOptions);
      if (state != 'SUCCESS') {
        let msg = 'Could not save options.';
        app.debug(msg);
        res.status(500);
        res.send(msg);
        return;
      }

      job.stop();
      res.json({
        status: job.getStatus()
      });
    })

    router.post("/jobs/create", (req, res) => {
      let job = req.body;

      let validated = validateJob(job);
      if (validated !== true) {
        app.debug(validated);
        res.status(400);
        res.send(validated);
        return;
      }

      let newjob = createJob(job);

      jobOptions.job.push(job);

      let state = saveOptions(jobOptions);
      if (state != 'SUCCESS') {
        let msg = '';
        app.debug(msg);
        res.status(500);
        res.send(msg);
        return;
      }

      res.json({
        status: newjob.getStatus()
      });
    })

    router.delete("/jobs/:jobid", (req, res) => {
      let jobid = req.params.jobid;
      let job = jobsTracker[jobid];

      if (!job) {
        let msg = 'No job found for ' + jobid
        app.debug(msg)
        res.status(400)
        res.send(msg)
        return
      }

      //remove job from the config
      jobOptions.job.splice(jobOptions.job.findIndex(v => v.name === jobid), 1);

      let state = saveOptions(jobOptions);
      if (state != 'SUCCESS') {
        let msg = '';
        app.debug(msg);
        res.status(500);
        res.send(msg);
        return;
      }

      job.destroy();

      //remove job from the jobsTracker
      delete jobsTracker[jobid];

      res.json({
        status: 'destroyed'
      });
    })
  }

  function createJob(job) {
    app.debug(`Creating schedule for job ${job.name}`);
    let schedule = createSchedule(job.time, job.days);

    let newjob;
    if (job.commandType == 'Shell') {
      newjob = cron.schedule(schedule, function() {

        shell.exec(job.command, function(code, stdout, stderr) {
          let hostname = os.hostname();
          let msg = `${hostname}: Scheduled job ${job.name} ${code != 0 ? 'failed' : 'was successful'}.`;
          let msgDetails = `Host: ${hostname} \r\nExit Code: ${code} \r\nProgram output: ${stdout} \r\nProgram error: ${stderr}`;

          if (code != 0) {
            app.error(msg);
            app.error(msgDetails);
          }

          if (job.sendEmail) {
            sendEmail(job.toEmail, msg, msgDetails);
          }
        });
      }, {
        scheduled: job.enabled
      });

      jobsTracker[job.name] = newjob;

      app.debug(`Created cron job: ${schedule} Shell Command ${job.command}`);
    } else if (job.commandType == 'SignalK Put') {
      let newjob = cron.schedule(schedule, function() {
        app.putSelfPath(job.path, job.value);

        let msg = `${job.path} set to ${job.value}`;
        app.debug(msg);

        if (job.sendEmail) {
          let to = job.toEmail;
          let hostname = os.hostname();
          let subject = `${hostname}: Scheduled job ${job.name} was successful.`;
          sendEmail(to, subject, msg);
        }
      }, {
        scheduled: job.enabled
      });

      jobsTracker[job.name] = newjob;

      app.debug(`Created cron job: ${schedule} SignalK Put ${job.path}=${job.value}`);
    } else if (job.commandType == 'SignalK Backup') {

      let newjob = cron.schedule(schedule, function() {
        runBackupJob(job);
      }, {
        scheduled: job.enabled
      });

      jobsTracker[job.name] = newjob;

      app.debug(`Created cron job: ${schedule} SignalK Backup ${job.backupPath}`);
    } else {
      app.error(`Job ${jobName} command type ${job.commandType} is not recognized.`);
    }

    return newjob;
  }

  function createSchedule(time, days) {
    let timeSplit = time.split(':');
    let minutes = timeSplit[1];
    let hours = timeSplit[0];

    let dayNums = days.map(function(day) {
      return WEEKDAYS.indexOf(day);
    })

    return `0 ${minutes} ${hours} * * ${dayNums}`;
  }

  async function runBackupJob(job) {
    const includePlugins = job.includePlugins ? 'true' : 'false';
    const filename = `signalk-${moment().format('MMM-DD-YYYY-HHTmm')}${BACKUP_EXTENSION}`;

    //create the backup
    let backupStatus = await createBackup(job.backupPath, filename, includePlugins);
    app.debug('Backup Status: ' + JSON.stringify(backupStatus));

    //rotate backups
    let deletedFiles;
    if (job.cleanup) {
      deletedFiles = await cleanupBackups(job.backupPath, job.numBackups);
    }

    //send an email
    if (job.sendEmail) {
      let to = job.toEmail;
      let hostname = os.hostname();
      let subject = `${hostname}: Scheduled job ${job.name}` + (backupStatus.success ? ' was successful.' : ' failed.');
      let msg = 'Backup file ' + backupStatus.filename + (backupStatus.success ? ' was created. ' : ' was not created. ');
      if (job.cleanup) {
        if (deletedFiles.length > 0) {
          msg += 'The following files were deleted during cleanup: \r\n';
          deletedFiles.forEach(file => msg += `${file}\r\n`);
        } else {
          msg += `No files were deleted during cleanup.`;
        }
      }
      sendEmail(to, subject, msg);
    }
  }

  async function createBackup(path, filename, includePlugins) {
    let port = app.config.settings.ssl ? app.config.settings.sslport : app.config.settings.port;
    let protocol = app.config.settings.ssl ? 'https' : 'http';
    const url = `${protocol}://localhost:${port}/backup?includePlugins=${includePlugins}`;
    app.debug('URL: ' + url);


    path = `${path}/${filename}`;
    app.debug('backup path: ' + path);

    let status = {
      success: false,
      filename: filename
    };

    const res = await fetch(url, {
      credentials: 'include',
      method: 'GET',
      headers: {
        'Content-Type': 'application/zip'
      }
    });

    await new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(path);
      res.body.pipe(fileStream);
      res.body.on("error", (err) => {
        app.error(err);
        reject(err);
      });
      fileStream.on("finish", function() {
        app.debug('Successfully created backup ' + path);
        status.success = true;
        resolve();
      });
    });

    return status;
  }

  async function cleanupBackups(dirPath, numToKeep) {
    let files = fs.readdirSync(dirPath, function(err, allFiles) {
      files = allFiles.filter(function(e) {
        return path.extname(e).toLowerCase() === BACKUP_EXTENSION
      });
    });

    files.sort();
    files.reverse();

    app.debug("Backup Files: " + JSON.stringify(files));

    let filesToDelete = [];
    if (files.length > numToKeep) {
      filesToDelete = files.slice(numToKeep);
      let unlinkQueue = filesToDelete.map(function(file) {
        return new Promise(function(resolve, reject) {
          let filepath = dirPath + '/' + file;
          app.debug('Deleting file ' + filepath);

          fs.unlink(filepath, function(err) {
            if (err) {
              app.debug('File delete error: ' + err)
              return reject(err);
            } else {
              app.debug('Deleted file ' + filepath);
              resolve(file);
            }
          });
        });
      });
      await Promise.all(unlinkQueue)
        .then(function(files) {
          app.debug('All files have been successfully removed');
        })
        .catch(function(err) {
          app.error('File delete error: ' + err)
        });
    }
    return filesToDelete;
  }

  function sendEmail(to, subject, text) {
    var transporter = nodemailer.createTransport({
      "host": jobOptions.mail.host,
      "port": jobOptions.mail.port,
      "secure": jobOptions.mail.secure,
      "auth": {
        "user": jobOptions.mail.username,
        "pass": jobOptions.mail.password
      }
    });

    //use text or html
    var mailOptions = {
      "from": jobOptions.mail.fromEmail,
      "to": to,
      "subject": subject,
      "text": text
    };

    transporter.sendMail(mailOptions, function(error, info) {
      if (error) {
        app.error(error);
      } else {
        app.log('Email sent: ' + info.response);
      }
    });
  }

  function saveOptions(options) {
    let status = 'SUCCESS';
    app.savePluginOptions(options, err => {
      if (err) {
        app.error(err.toString())
        status = 'FAILURE';
      }
    })
    return status;
  }

  function validateJob(job) {
    let example = {
      "name": "Test1",
      "time": "12:00",
      "days": [
        "Tuesday",
        "Thursday",
        "Saturday"
      ],
      "commandType": "SignalK Put",
      "enabled": true,
      "sendEmail": false,
    };

    //compare objects


    //make sure days are correct
    let daysTest = job.days.map(function(day) {
      return WEEKDAYS.indexOf(day);
    })
    if (daysTest.includes(-1) || daysTest.length > 7) {
      return 'Days must be one or more of ' + WEEKDAYS;
    }

    //make sure commandType is correct
    if (JOBTYPES.indexOf(job.commandType) == -1) {
      return "commandType must be one of " + JOBTYPES;
    }

    //if commandType == shell
    if (job.commandType == 'Shell') {
      if (!job.command) {
        exmaple.command = '';
        return "commandType of 'Shell' must include a 'command' property. " + JSON.stringify(example);
      }
    }

    //if commandType == SignalK Put
    if (job.commandType == 'SignalK Put') {
      if (!job.path || !job.value) {
        example.path = "electrical.switches.bank.erDcr22.wmBackwash.state";
        example.value = "1";

        return "commandType of 'SignalK Put' must include a 'path' and 'value' properties. " + JSON.stringify(example);
      }
    }

    //if commandType == SignalK Put
    if (job.commandType == 'SignalK Backup') {
      if (!job.backupPath || !job.numBackups) {
        example.backupPath = '/backups';
        example.numBackups = 7;
        return "commandType of 'SignalK Backup' must include a 'backupPath' and 'numBackups' properties. " + JSON.stringify(example);
      }
    }

    //if sendEmail
    if (job.sendEmail) {
      if (!job.toEmail) {
        example.sendEmail = true;
        example.toEmail = 'someone@something.com';
        return "Property 'toEmail' must be a valid address when 'sendEmail' is true. " + JSON.stringify(example);
      }
    }

    return true;
  }

  return plugin;
};
