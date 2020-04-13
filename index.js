const cron = require("node-cron");
let shell = require("shelljs");
let nodemailer = require("nodemailer");

const PLUGIN_ID = 'signalk-scheduler'
const PLUGIN_NAME = 'Scheduler'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
    jobsTracker = {};
    jobOptions = options;

    for (var jobName in options.job) {
      let job = options.job[jobName];

      if (job.enabled) {
        createJob(job);
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

      res.json({
        status: job.getStatus()
      });
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

      job.start();
      res.json({
        status: job.getStatus()
      });
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

      if (job.enabled) {
        createJob(job);
      }

      jobOptions.job.push(job);
      saveOptions(jobOptions);

      res.json({
        status: job.getStatus()
      });
    })

    router.get("/jobs/:jobid/destroy", (req, res) => {
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
      delete jobOptions.job[jobid];
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

    if (job.commandType == 'Shell') {
      let newjob = cron.schedule(schedule, function() {
        if (shell.exec(job.command).code !== 0) {
          let msg = `Scheduled job ${job.name} failed.`;
          app.error(msg);

          if (job.sendEmail) {
            let to = job.toEmail;
            let subject = msg;
            let text = msg;
            sendEmail(to, subject, text);
          }
        } else {
          let msg = `Scheduled job ${job.name} was successful.`;
          shell.echo(msg);
          if (job.sendEmail) {
            let to = job.toEmail;
            let subject = msg;
            let text = msg;
            sendEmail(to, subject, text);
          }
        }
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
          let subject = `Scheduled job ${job.name} was successful.`;
          sendEmail(to, subject, msg);
        }
      });

      jobsTracker[job.name] = newjob;

      app.debug(`Created cron job: ${schedule} SignalK Put ${job.path}=${job.value}`);
    } else {
      app.error(`Job ${jobName} command type ${job.commandType} is not recognized.`);
    }
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
    let daysTest = days.map(function(day) {
      return WEEKDAYS.indexOf(day);
    })
    if (daysTest.includes(-1) || daysTest.length > 7) {
      return 'Days must be one or more of ' + WEEKDAYS;
    }

    //make sure commandType is correct
    if (job.commandType != 'Shell' || job.commandType != 'SignalK Put') {
      return "commandType must be 'Shell' or 'SignalK Put'";
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
