import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {JwtModule} from "@nestjs/jwt";

// @ts-ignore
@Module({
  controllers: [JwtModule.register({}),AuthController],
  providers: [AuthService]
})
export class AuthModule {}
