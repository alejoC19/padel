import { Matches } from 'class-validator';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DailyCloseDto {
  @Matches(LOCAL_DATE, { message: 'Formato esperado: YYYY-MM-DD' })
  date!: string;
}

export class PeriodDto {
  @Matches(LOCAL_DATE, { message: 'Formato esperado: YYYY-MM-DD' })
  from!: string;

  @Matches(LOCAL_DATE, { message: 'Formato esperado: YYYY-MM-DD' })
  to!: string;
}
