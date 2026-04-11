import { IsNotEmpty, IsOptional } from 'class-validator';

export class CreatePlaylistDto {
  @IsNotEmpty()
  name: string;

  @IsOptional()
  description: string;

  @IsOptional()
  isPublic: boolean;
}
