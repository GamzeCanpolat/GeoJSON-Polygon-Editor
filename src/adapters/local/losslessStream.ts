import { Tokenizer, TokenParser, type JSONParserOptions, type ParsedTokenInfo, type ParsedElementInfo } from '@streamparser/json';
import { parseJsonNumber } from '../../domain/losslessJson';

class ExactTokenizer extends Tokenizer {
  protected parseNumber(text: string): number {
    // Third-party types declare NUMBER tokens as number only. TokenParser
    // stores the value unchanged; this bridge also carries native bigint.
    return parseJsonNumber(text) as number;
  }
}

/** Same streaming lifecycle as JSONParser, using its public tokenizer/parser. */
export class LosslessJsonStream {
  private tokenizer: ExactTokenizer;
  private parser: TokenParser;
  constructor(options: JSONParserOptions = {}) {
    this.tokenizer = new ExactTokenizer(options); this.parser = new TokenParser(options);
    this.tokenizer.onToken = token => this.consume(token);
    this.tokenizer.onEnd = () => { if (!this.parser.isEnded) this.parser.end(); };
    this.parser.onEnd = () => { if (!this.tokenizer.isEnded) this.tokenizer.end(); };
    this.parser.onError = error => { throw error; };
    this.tokenizer.onError = error => { throw error; };
  }
  get isEnded() { return this.tokenizer.isEnded && this.parser.isEnded; }
  private consume(token: ParsedTokenInfo.ParsedTokenInfo) {
    try { this.parser.write(token); }
    catch (error) {
      // The dependency's syntax-error formatter uses JSON.stringify, which
      // cannot format bigint. Keep malformed input a useful parse rejection.
      if (error instanceof TypeError && error.message.includes('BigInt')) throw new Error('Geçersiz GeoJSON sözdizimi: sayı beklenmeyen bir konumda.');
      throw error;
    }
  }
  write(input: Uint8Array) { this.tokenizer.write(input); }
  end() { this.tokenizer.end(); }
  set onToken(callback: (token: ParsedTokenInfo.ParsedTokenInfo) => void) {
    this.tokenizer.onToken = token => { callback(token); this.consume(token); };
  }
  set onValue(callback: (info: ParsedElementInfo.ParsedElementInfo) => void) { this.parser.onValue = callback; }
}
