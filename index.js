const cron = require("node-cron");
const os = require('os');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
let shell = require("shelljs");
let nodemailer = require("nodemailer");

const PLUGIN_ID = 'signalk-scheduler'
const PLUGIN_NAME = 'Scheduler'

const JOBTYPES = ["Shell", "SignalK Put", "SignalK Puts", "SignalK Backup"];
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
            "event": {
              "type": "string",
              "title": "Event",
              "enum": [
                "Set Time",
                "Event Time"
              ],
              "default": "Set Time"
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
              "enum": JOBTYPES
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
                },
                {
                  "properties": {
                    "commandType": {
                      "enum": [
                        "SignalK Puts"
                      ]
                    },
                    "skputs": {
                      "type": "array",
                      "title": "SK Puts",
                      "items": {
                        "type": "object",
                        "properties": {
                          "path": {
                            "type": "string",
                            "title": "SignalK Path"
                          },
                          "value": {
                            "type": "string",
                            "title": "Value"
                          }
                        }
                      }
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
            },
            "event": {
              "oneOf": [{
                  "properties": {
                    "event": {
                      "enum": [
                        "Set Time"
                      ]
                    },
                    "time": {
                      "type": "string",
                      "title": "Time (24hr)",
                      "pattern": "^[0-2]\\d:[0-5]\\d$"
                    }
                  }
                },
                {
                  "properties": {
                    "event": {
                      "enum": [
                        "Event Time"
                      ]
                    },
                    "eventPath": {
                      "type": "string",
                      "title": 'Event Path',
                      "description": 'SK Path that contains a properly formatted date. Ex. environment.sunlight.times.sunset'
                    },
                    "offset": {
                      "type": "string",
                      "title": "Offset +/- hr:min",
                      "description": "Rather than starting at the event time, you can start before or after. Ex. turn on your deck lights 10 minutes before sunset.",
                      "pattern": "^[+-][0-2]\\d:[0-5]\\d$"
                    }
                  }
                }
              ]
            },
            "cleanup": {
              "oneOf": [{
                "properties": {
                  "cleanup": {
                    "enum": [
                      true
                    ]
                  },
                  "numBackups": {
                    "type": "number",
                    "title": "Number of Backups to Keep.",
                    "description": "The number of backups to be kept. All other backup files will be removed."
                  }
                }
              }]
            }
          }
        }
      }
    }
  }

  plugin.uiSchema = {
    "job": {
      "items": {
        'ui:order': [
          'name',
          'enabled',
          'sendEmail',
          'toEmail',
          'event',
          'eventPath',
          'offset',
          'time',
          'days',
          '*' // all undefined ones come here.
        ]
      }
    }
  }

  plugin.start = function(options, restartPlugin) {
    app.debug('Plugin started');
    jobsTracker = {};
    jobOptions = options;

    //runs once a day to update schedules based on event times
    createInternalJobs();

    //schedule all of the static jobs
    let staticJobs = options.job.filter(job => job.hasOwnProperty('time'));
    staticJobs.forEach((job) => {
      createJob(job);
    });

    //add a short delay after startup to insure that event data will be ready
    setTimeout(updateSchedules, 30000);

    let numJobs = Object.keys(jobsTracker).length;
    app.setPluginStatus(`${numJobs} jobs have been scheduled.`);
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
      let jobDeleted = deleteJob(jobid);

      if (!jobDeleted) {
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

      res.json({
        status: 'destroyed'
      });
    })
  }

  function createInternalJobs() {
    let job = {
      "name": "INTERNAL___updateSchedules",
      "enabled": true,
      "sendEmail": false,
      "event": "Set Time",
      "days": [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday"
      ],
      "commandType": "internalJobs",
      "time": "00:00"
    };

    createJob(job);
  }

  function createJob(job) {
    let time = job.hasOwnProperty('time') ? job.time : getEventTime(job.eventPath, job.offset);
    app.debug(`${job.name} time: ${time}`);

    if (!time) {
      app.error(`Job ${job.name} was not scheduled because of an issue with the time.`)
      return;
    }

    let schedule = createSchedule(time, job.days);

    let newjob;
    if (job.commandType == 'Shell') {

      newjob = cron.schedule(schedule, function() {
        runShellJob(job);
      }, {
        scheduled: job.enabled
      });

    } else if (job.commandType == 'SignalK Put' || job.commandType == 'SignalK Puts') {

      newjob = cron.schedule(schedule, function() {
        runPutJob(job);
      }, {
        scheduled: job.enabled
      });

    } else if (job.commandType == 'SignalK Backup') {

      newjob = cron.schedule(schedule, function() {
        runBackupJob(job);
      }, {
        scheduled: job.enabled
      });

    } else if (job.commandType == 'internalJobs') {

      newjob = cron.schedule(schedule, function() {
        updateSchedules();
      }, {
        scheduled: job.enabled
      });

    } else {
      app.error(`Job ${job.name} command type ${job.commandType} is not recognized.`);
    }

    if (newjob) {
      jobsTracker[job.name] = newjob;
      app.debug(`${job.enabled ? 'Enabled' : 'Disabled'} cron job: ${job.name} - ${job.commandType} - ${schedule}`);
    }

    return newjob;
  }

  function deleteJob(jobName) {
    let cronjob = jobsTracker[jobName];
    if (cronjob) {
      cronjob.destroy();
      delete jobsTracker[jobName];
      return true;
    }

    return false;
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

  function updateSchedules() {
    //look for jobs that are event based
    let eventJobs = jobOptions.job.filter(job => job.event === 'Event Time');

    eventJobs.forEach((job) => {
      //delete the job
      deleteJob(job.name);

      //create the new job
      createJob(job);
    });

    let numJobs = Object.keys(jobsTracker).length;
    app.setPluginStatus(`${numJobs} jobs have been scheduled.`);
  }

  function getEventTime(eventPath, offset) {
    let event = app.getSelfPath(eventPath);
    if (!event) {
      app.error(`No event info found for ${eventPath}`);
      return null;
    }

    let time = Date.parse(event.value);
    if (isNaN(time)) {
      app.error(`Could not calculate event time for ${eventPath} with offset ${offset}`);
      return null;
    }

    let operator = offset[0];
    let minutes = moment.duration({
      minutes: offset.slice(1).split(':')[1],
      hours: offset.slice(1).split(':')[0]
    }).asMinutes();
    app.debug(`Offset minutes: ${operator}${minutes}`);

    if (operator === '-') {
      return moment(time).subtract(minutes, 'm').format('HH:mm');
    } else {
      return moment(time).add(minutes, 'm').format('HH:mm');
    }
  }

  function runShellJob(job) {
    shell.exec(job.command, function(code, stdout, stderr) {
      let msg = `Scheduled job ${job.name} ${code != 0 ? 'failed' : 'was successful'}.`;
      let msgDetails = `Host: ${hostname} \r\nExit Code: ${code} \r\nProgram output: ${stdout} \r\nProgram error: ${stderr}`;

      if (code != 0) {
        app.error(msg);
        app.error(msgDetails);
      }

      if (job.sendEmail) {
        sendEmail(job.toEmail, msg, msgDetails);
      }
    });
  }

  function runPutJob(job) {
    let jobQueue = sendSkPut(job);

    Promise.all(jobQueue)
      .then((values) => {
        let msg = '';
        let failure = 0;
        values.forEach(function(value) {
          if (value.statusCode === 200) {
            msg += `${value.path} was set to ${value.value}.\r\n`
          } else {
            failure++;
            msg += `ERROR: ${value.path} was not set to ${value.value}.\r\n`
          }
        })
        if (job.sendEmail) {
          let to = job.toEmail;
          let subject = `Scheduled job ${job.name} `;
          if (failure > 0) {
            subject += `had ${failure} failures.`;
          } else {
            subject += 'was successful.';
          }
          sendEmail(to, subject, msg);
        }
      })
      .catch(function(err) {
        let msg = `Job execution error: ${err.statusCode} ${err.message}`;
        app.error(msg);
        if (job.sendEmail) {
          let to = job.toEmail;
          let subject = `Scheduled job ${job.name} failed.`;
          sendEmail(to, subject, msg);
        }
      });
  }

  function sendSkPut(job) {
    if (job.hasOwnProperty('path')) {
      job.skputs = [{
        path: job.path,
        value: job.value
      }];
    }

    return job.skputs.map(function(subjob) {
      return new Promise(function(resolve, reject) {
        app.putSelfPath(subjob.path, Number.isInteger(subjob.value) ? parseInt(subjob.value) : subjob.value, res => {
          app.debug(JSON.stringify(res))
          if (res.state == 'COMPLETED') {
            res.path = subjob.path;
            res.value = subjob.value;

            if (res.statusCode === 200) {
              app.debug(`Job ${job.name} executed ${subjob.path} set to ${subjob.value}`);
              resolve(res);
            } else {
              app.debug(`Job ${job.name} execution error ${res.statusCode} ${res.message} while settting ${subjob.path} to ${subjob.value}`);
              return reject(res);
            }
          }
        });
      });
    });
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
      let subject = `Scheduled job ${job.name}` + (backupStatus.success ? ' was successful.' : ' failed.');
      let msg = 'Backup file ' + backupStatus.filename + (backupStatus.success ? ' was created. ' : ' was not created. ');
      if (job.cleanup) {
        if (deletedFiles.length > 0) {
          msg += 'The following files were deleted during cleanup: \r\n';
          deletedFiles.forEach(file => msg += `${file.name}\r\n`);
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

    let dirents = fs.readdirSync(dirPath, {
        withFileTypes: true
      })
      .filter(e => e.isFile() && path.extname(e.name).toLowerCase() === BACKUP_EXTENSION);

    let files = dirents.map(function(file) {
        let time = fs.statSync(dirPath + '/' + file.name).birthtimeMs;
        return {
          name: file.name,
          time: time
        }
      })
      .sort(function(a, b) {
        return b.time - a.time;
      });

    app.debug("Backup Files sorted: " + JSON.stringify(files));

    let filesToDelete = [];
    if (files.length > numToKeep) {
      filesToDelete = files.slice(numToKeep);
      let unlinkQueue = filesToDelete.map(function(file) {
        return new Promise(function(resolve, reject) {
          let filepath = dirPath + '/' + file.name;
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

    subject = `${os.hostname()}: ${subject}`;

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
