// The explainability contract — port of ItemDatabase/armory_engine/explain.py.
// `textKey` is always a translation key, never a sentence.

export class Reason {
  constructor({ statId, delta, weight, textKey, textKwargs = {} }) {
    this.statId = statId;
    this.delta = delta;
    this.weight = weight;
    this.textKey = textKey;
    this.textKwargs = textKwargs;
    Object.freeze(this);
  }

  get scoreContribution() { return this.delta * this.weight; }
}

export class Recommendation {
  constructor({ pick, scoreDelta, reasons = [], textKey = "", textKwargs = {} }) {
    this.pick = pick;
    this.scoreDelta = scoreDelta;
    this.reasons = Object.freeze([...reasons]);
    this.textKey = textKey;
    this.textKwargs = textKwargs;
    Object.freeze(this);
  }
}
