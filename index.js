const cron = require("node-cron");
const fs = require("fs");
let shell = require("shelljs");
let nodemailer = require("nodemailer");

const PLUGIN_ID = 'signalk-scheduler'
const PLUGIN_NAME = 'Scheduler'

module.exports = function(app) {
  var plugin = {};
  var jobOptions = {};
  var jobsTracker = {};

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = 'Plugin that does stuff';

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
                "SignalK Put"
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
                      "title": "Shell Command"
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
    jobOptions = options;

    for (var jobName in options.job) {
      let job = options.job[jobName];

      if (job.enabled) {
        app.debug(`Creating schedule for job ${job.name}`);
        let schedule = createSchedule(job.time, job.days);

        if (job.commandType == 'Shell') {
          let newjob = cron.schedule(schedule, function() {
            if (shell.exec(job.command).code !== 0) {
              shell.exit(1);
              app.error(`Scheduled job ${job.name} failed.`);

              if (job.sendEmail) {
                let to = job.toEmail;
                let subject = ``;
                let text = ``;
                sendEmail(to, subject, text);
              }
            } else {
              shell.echo(`Schedule job ${job.name} was successful.`);
              if (job.sendEmail) {
                let to = job.toEmail;
                let subject = ``;
                let text = ``;
                sendEmail(to, subject, text);
              }
            }
          });

          jobsTracker[job.name] = newjob;

          app.debug(`Created cron job: ${schedule} Shell Command ${job.command}`);
        } else if (job.commandType == 'SignalK Put') {
          let newjob = cron.schedule(schedule, function() {
            handleDelta(job.path, job.value);

            if (job.sendEmail) {
              let to = job.toEmail;
              let subject = ``;
              let text = ``;
              sendEmail(to, subject, text);
            }
          });

          jobsTracker[job.name] = newjob;

          app.debug(`Created cron job: ${schedule} SignalK Put ${job.path}=${job.value}`);
        } else {
          app.error(`Job ${jobName} command type ${job.commandType} is not recognized.`);
        }
      } else {
        app.debug(`Job ${job.name} is not enabled.`)
      }
    }

  };

  plugin.stop = function() {
    // Here we put logic we need when the plugin stops
    app.debug('Plugin stopped');
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

      job.isRunning = jobsTracker[jobid].running || false;
      res.json(job);
    })

    router.get("/jobs/:jobid/status", (req, res) => {
      let jobid = req.params.jobid;
      let job = jobsTracker[jobid];

      if (!job) {
        let msg = 'No job found for ' + jobid
        app.debug(msg)
        res.status(400)
        res.send(msg)
        return
      }

      res.json(job.getStatus());
    })

    router.get("/jobs/:jobid/start", (req, res) => {
      let jobid = req.params.jobid;
      let job = jobsTracker[jobid];

      if (!job) {
        let msg = 'No job found for ' + jobid
        app.debug(msg)
        res.status(400)
        res.send(msg)
        return
      }

      res.json(job.start());
    })

    router.get("/jobs/:jobid/stop", (req, res) => {
      let jobid = req.params.jobid;
      let job = jobsTracker[jobid];

      if (!job) {
        let msg = 'No job found for ' + jobid
        app.debug(msg)
        res.status(400)
        res.send(msg)
        return
      }

      res.json(job.stop());
    })
  }

  function createSchedule(time, days) {
    let timeSplit = time.split(':');
    let minutes = timeSplit[1];
    let hours = timeSplit[0];

    let WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let dayNums = days.map(function(day) {
      return WEEKDAYS.indexOf(day);
    })

    return `0 ${minutes} ${hours} * * ${dayNums}`;
  }

  function handleDelta(path, value) {
    let delta = {
      "updates": [{
        "values": [{
          path: path,
          value: value
        }]
      }]
    }
    app.debug(JSON.stringify(delta))

    app.handleMessage(PLUGIN_ID, delta)
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

  return plugin;
};
