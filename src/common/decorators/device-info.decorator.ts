import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { DeviceType } from '../../generated/prisma/enums';

export const GetDeviceInfo = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();

    const ip = request.headers['x-forwarded-for']
      ? (request.headers['x-forwarded-for'] as string).split(',')[0].trim()
      : request.ip || request.socket.remoteAddress;
    const userAgent = request.headers['user-agent'] || '';

    const headerDeviceType = (
      request.headers['x-device-type'] as string | undefined
    )?.toUpperCase();
    const isValidHeaderDeviceType =
      headerDeviceType &&
      Object.values(DeviceType).includes(headerDeviceType as DeviceType);

    let deviceType: DeviceType;
    if (isValidHeaderDeviceType) {
      deviceType = headerDeviceType as DeviceType;
    } else {
      deviceType = DeviceType.WEB;
      if (/android/i.test(userAgent)) deviceType = DeviceType.ANDROID;
      else if (/iphone|ipad|ipod/i.test(userAgent)) deviceType = DeviceType.IOS;
    }

    return {
      deviceType,
      userAgent,
      ipAddress: ip as string,
      deviceId: request.headers['x-device-id'] as string,
      deviceName: request.headers['x-device-name'] as string,
    };
  },
);
