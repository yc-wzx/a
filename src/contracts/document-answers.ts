export type DocumentAnswer = {
  answer: string;
  citations: { sourceId: string; documentId: string; title: string; quote: string; href: string }[];
  limited: boolean;
};
