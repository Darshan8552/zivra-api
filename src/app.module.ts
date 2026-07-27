import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {ConfigModule} from "@nestjs/config";
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import jwtConfig from "./config/jwt.config";

@Module({
  imports: [ConfigModule.forRoot({
    isGlobal: true,
    cache: true,
    expandVariables: true,
    load: [jwtConfig],
  }), PrismaModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
