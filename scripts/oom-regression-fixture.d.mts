export interface OomRegressionFixture {
  source: string;
  sourceName: string;
  pageCount: number;
  ids: Readonly<{
    fragmentRoot: string;
    copyRoot: string;
    editableText: string;
  }>;
}

export const OOM_FIXTURE_IDS: OomRegressionFixture["ids"];
export function buildOomRegressionFixture(): OomRegressionFixture;
