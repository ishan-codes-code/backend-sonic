import { IsEnum, IsUUID } from 'class-validator';

export enum TasteSignalType {
  MANUAL_QUEUE = 'manual_queue',
  PLAY_NEXT = 'play_next',
}

export class TasteSignalDto {
  @IsUUID()
  songId: string;

  @IsEnum(TasteSignalType)
  signalType: TasteSignalType;
}
