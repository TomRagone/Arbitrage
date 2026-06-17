import { prisma } from "./client";
import { writeAudit } from "./audit";

const SINGLETON = "singleton";

export async function getSystemConfiguration() {
  return prisma.systemConfiguration.upsert({
    where: { id: SINGLETON },
    update: {},
    create: { id: SINGLETON },
  });
}

export async function getSettings() {
  return prisma.settings.upsert({
    where: { id: SINGLETON },
    update: {},
    create: { id: SINGLETON },
  });
}

/// The single guard the worker MUST call before any trading action.
/// Trading is allowed only when explicitly enabled, the kill switch is off,
/// and we are not in maintenance mode.
export async function isTradingAllowed(): Promise<boolean> {
  const cfg = await getSystemConfiguration();
  return cfg.tradingEnabled && !cfg.killSwitchEngaged && !cfg.maintenanceMode;
}

/// Hard stop. Engaging the kill switch also disables trading and is audited.
export async function engageKillSwitch(actor: string, reason: string) {
  await prisma.systemConfiguration.update({
    where: { id: SINGLETON },
    data: { killSwitchEngaged: true, tradingEnabled: false, killSwitchReason: reason },
  });
  await writeAudit({ actor, action: "killswitch.engaged", data: { reason } });
}

export async function releaseKillSwitch(actor: string) {
  await prisma.systemConfiguration.update({
    where: { id: SINGLETON },
    data: { killSwitchEngaged: false, killSwitchReason: null },
  });
  await writeAudit({ actor, action: "killswitch.released" });
}
