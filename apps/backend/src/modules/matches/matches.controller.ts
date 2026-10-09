import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MatchesService } from './matches.service';
import { MatchDetailDto, MatchListItemDto, QueryMatchesDto } from './dto';

@ApiTags('Matches')
@Controller('matches')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get()
  @ApiOperation({
    summary: 'Meccslista lekérése',
    description:
      'Lapozható meccslista — szűrés státuszra és időablakra. A válasz tartalmazza a hátralévő szabad helyek számát és az isHome flag-et.',
  })
  @ApiOkResponse({ type: [MatchListItemDto] })
  findAll(@Query() query: QueryMatchesDto): Promise<MatchListItemDto[]> {
    return this.matchesService.findAll(query);
  }

  @Get('upcoming')
  @ApiOperation({
    summary: 'Közelgő meccsek',
    description:
      'A következő legfeljebb 5 közelgő (status=ON_SALE vagy SCHEDULED) meccs, kezdési idő szerint növekvő sorrendben.',
  })
  @ApiOkResponse({ type: [MatchListItemDto] })
  findUpcoming(): Promise<MatchListItemDto[]> {
    return this.matchesService.findUpcoming(5);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Meccs részletes lekérése azonosító alapján' })
  @ApiOkResponse({ type: MatchDetailDto })
  async findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<MatchDetailDto> {
    const match = await this.matchesService.findOne(id);
    if (!match) {
      throw new NotFoundException(`Match ${id} not found`);
    }
    return match;
  }
}
