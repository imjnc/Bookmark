export const STOP = new Set(('a an and are as at be but by for from has have how i in is it its of on or that the this to was were what when where which who why with ' +
  'about find show me my page passage line lines quote book books read reading remember discusses discuss author looking look any some there their they we you your into can do does did').split(' '));

export const tokenize = (s) => (String(s).toLowerCase().match(/[a-z0-9À-￿]+/g) || []);
export const contentTokens = (s) => tokenize(s).filter((t) => !STOP.has(t) && t.length > 1);
export const stem = (w) => (w.length > 4 ? w.replace(/(ing|ed|es|s|ly)$/, '') : w);
