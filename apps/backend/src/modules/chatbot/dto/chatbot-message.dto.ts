import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ChatbotMessageDto {
  @ApiProperty({ description: 'A felhasználó kérdése (max 1000 karakter)' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message!: string;

  @ApiPropertyOptional({
    description:
      'A korábbi válaszban kapott, szerver által kiosztott azonosító. Ha hiányzik, új beszélgetés indul. Csak az indító hívó folytathatja; idegen azonosító 403, ismeretlen vagy lejárt 404.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;
}

export class ChatbotResponseDto {
  @ApiProperty({ description: 'Beszélgetés azonosítója (perzisztens 24 óráig)' })
  conversationId!: string;

  @ApiProperty({ description: 'A modell válasza' })
  reply!: string;

  @ApiProperty({ description: 'A modell, amit a háttér használt' })
  model!: string;
}
