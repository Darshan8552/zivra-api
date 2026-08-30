import { DeviceType } from '../../generated/prisma/enums';

export interface DeviceInfo {
  deviceId?: string | null;
  deviceName?: string | null;
  deviceType: DeviceType;
  userAgent?: string | null;
  ipAddress?: string | null;
}
