self.onmessage = (event) => {
  const { alertConfigs, findings, dismissedList } = event.data;
  const dismissed = new Set(dismissedList);
  const newTriggeredAlerts: any[] = [];
  
  const timestamp = new Date().toLocaleString();

  alertConfigs.forEach((config: any) => {
    findings.forEach((finding: any) => {
      if (!dismissed.has(finding.id)) {
        const metric = parseFloat(finding[config.metric.toLowerCase()] || 0);
        let triggered = false;

        if (config.thresholdType === "below") {
          triggered = metric < config.threshold;
        } else if (config.thresholdType === "above") {
          triggered = metric > config.threshold;
        }

        if (triggered && finding.type.includes(config.resourceType)) {
          const alertId = `${config.id}-${finding.id}`;
          const existingAlert = newTriggeredAlerts.find(
            (a) => a.id === alertId,
          );
          if (!existingAlert) {
            newTriggeredAlerts.push({
              id: alertId,
              configId: config.id,
              resourceId: finding.id,
              resourceType: finding.type,
              metric: config.metric,
              value: metric,
              threshold: config.threshold,
              condition: config.thresholdType,
              timestamp: timestamp,
            });
          }
        }
      }
    });
  });

  self.postMessage(newTriggeredAlerts);
};
