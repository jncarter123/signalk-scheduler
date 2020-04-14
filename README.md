# signalk-scheduler

Cron like scheduler for SignalK. It can execute shell commands and SignalK puts at a prescibed time and day(s).
Yes these things can be done using other tools like cron and Node-Red and those are great tools. I wanted something easy to use with little 
learning curve and right there in the same UI I do everything else. This also has the added benefit of email integration.

## Example Ideas

**Shell Commands**
* Backups
* Log rotation
* Email disk usage reports (df -h)
* Daily status report...

**SignalK Put**
* Turn a NMEA2000 switch off or on
  * Turn on the anchor light at night, turn it off in the morning...
  * Turn on salon lights of an evening so the boat is lit when you get back...
* ???

I'd love to hear other ideas for implementation and will accept pull requests if you would like to add your own.

## API
### Get a list of all jobs
GET /jobs

### Create a new job
POST /jobs/create

The body is the same json that is stored in .signalk/plugin-config-data/signalk-scheduler.json
Example:
```JSON
{
      "name": "Test2",
      "time": "08:00",
      "days": [
        "Monday"
      ],
      "commandType": "Shell",
      "command": "df -h",
      "enabled": true,
      "sendEmail": true,
      "toEmail": "someone@company.com"
}
```

### Get details of a job
GET /jobs/{job_name}

### Delete a job
DELETE /jobs/{job_name}

### Start the job schedule
PUT /jobs/{job_name}/start

### Stop the job schedule
PUT /jobs/{job_name}/stop




