// text-embedding-3-* use the cl100k_base encoding.
import { countTokens as countCl100kTokens } from 'gpt-tokenizer/encoding/cl100k_base';

/** Number of embedding-model tokens in `text`. */
export function countTokens(text: string): number {
  return countCl100kTokens(text);
}
