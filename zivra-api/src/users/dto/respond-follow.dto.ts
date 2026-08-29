import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class RespondFollowDto {
  @IsString()
  @IsUUID('7')
  @IsNotEmpty()
  actorId!: string;
}
