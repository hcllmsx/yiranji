declare module 'lunar-javascript' {
  export class Solar {
    static fromDate(date: Date): Solar;
    static fromYmd(year: number, month: number, day: number): Solar;
    getLunar(): Lunar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
  }

  export class Lunar {
    /** month 为负数表示闰月，例如 -3 表示闰三月 */
    static fromYmd(year: number, month: number, day: number): Lunar;
    getSolar(): Solar;
    /** 返回农历年份 */
    getYear(): number;
    /** 返回农历月份，闰月时为负数 */
    getMonth(): number;
    /** 返回农历日期数字 */
    getDay(): number;
    /** 返回中文月份名，闰月时包含"闰"前缀，如"闰三" */
    getMonthInChinese(): string;
    /** 返回中文日期名，如"廿三" */
    getDayInChinese(): string;
    /** 返回中文年份名，如"一九九三" */
    getYearInChinese(): string;
    /** 返回生肖，如"鸡" */
    getYearShengXiao(): string;
    /** 返回完整中文字符串，如"一九九三年闰三月廿三" */
    toString(): string;
  }

  export class LunarYear {
    static fromYear(year: number): LunarYear;
    getLeapMonth(): number;
  }
}

