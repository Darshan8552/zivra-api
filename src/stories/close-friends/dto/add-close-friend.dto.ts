import { IsString } from 'class-validator';

export class AddCloseFriendDto {
  @IsString()
  username!: string;
}
