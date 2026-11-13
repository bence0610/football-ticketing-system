import { ApiProperty } from '@nestjs/swagger';

export class PaymentIntentSeatLineDto {
  @ApiProperty({ format: 'uuid' })
  seatId!: string;

  @ApiProperty()
  section!: string;

  @ApiProperty()
  row!: string;

  @ApiProperty()
  seatNumber!: number;

  @ApiProperty()
  price!: number;
}

export class PaymentIntentResponseDto {
  @ApiProperty()
  paymentIntentId!: string;

  @ApiProperty({
    description: 'Stripe.js confirmCardPayment hívásához használandó client secret.',
  })
  clientSecret!: string;

  @ApiProperty({ example: 'huf' })
  currency!: string;

  @ApiProperty({
    description:
      'A ténylegesen terhelt teljes összeg HUF-ban (egész szám), a hűségszint-kedvezménnyel csökkentve.',
  })
  amount!: number;

  @ApiProperty({
    description:
      'A tételek listaár-összege HUF-ban, kedvezmény nélkül (amount + discountAmount). A kliens ezt jeleníti meg, nem számolja ki.',
  })
  subtotal!: number;

  @ApiProperty({
    type: [PaymentIntentSeatLineDto],
    description:
      'Tételek listaáron (kedvezmény nélkül); a kedvezmény a teljes összegre vonatkozik.',
  })
  lineItems!: PaymentIntentSeatLineDto[];

  @ApiProperty({
    description: 'A vevő hűségszintjéhez tartozó kedvezmény százalékban (0-100).',
    example: 10,
  })
  discountPercent!: number;

  @ApiProperty({
    description: 'A kedvezmény összege HUF-ban (listaár-összeg mínusz amount).',
    example: 700,
  })
  discountAmount!: number;
}
