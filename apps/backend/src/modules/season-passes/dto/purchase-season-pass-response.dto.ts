import { ApiProperty } from '@nestjs/swagger';

export class PurchaseSeasonPassResponseDto {
  @ApiProperty({ example: 'pi_3OabcdEfGhIjKl' })
  paymentIntentId!: string;

  @ApiProperty({
    example: 'pi_3OabcdEfGhIjKl_secret_xyz',
    description:
      'Stripe Payment Intent client secret. Akkor szükséges, ha a fizetés további megerősítést igényel (pl. 3DS).',
    nullable: true,
  })
  clientSecret!: string | null;

  @ApiProperty({
    example: 'succeeded',
    description: 'Stripe Payment Intent státusza a megerősítési kísérlet után.',
  })
  status!: string;

  @ApiProperty({
    example: '6f1f0e30-1d7e-4b73-9c4f-7c0a1d3e4f12',
    description: 'A létrejött bérlet (SeasonPass) azonosítója — csak sikeres fizetés esetén.',
    required: false,
    nullable: true,
  })
  seasonPassId?: string | null;

  @ApiProperty({ example: true, description: 'Igaz, ha a fizetés azonnal sikeres lett.' })
  succeeded!: boolean;

  @ApiProperty({ example: '2026/2027' })
  seasonLabel!: string;

  @ApiProperty({ example: 30000 })
  amount!: number;

  @ApiProperty({ example: 'HUF' })
  currency!: string;
}
