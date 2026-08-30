import { SndResource } from '../resource_parsers/SndResource';

// The lamejs package only works when loaded by CommonJS at runtime (under a
// static bundler its sources reference undefined globals), so it is required
// lazily here instead of being imported. Direct eval keeps the CommonJS
// require of the enclosing module wrapper out of the bundler's reach.
const lazyRequire = eval("require") as (id: string) => typeof import("lamejs");


export async function SoundFileParse(sound: SndResource): Promise<ArrayBuffer> {
    let mp3Samples: number[];
    let mp3Rate: number;
    try {
        ({ mp3Samples, mp3Rate } = sound.sound);
    } catch (e) {
        console.warn(e);
        mp3Samples = [];
        mp3Rate = 8000;
    }
    const { Mp3Encoder } = lazyRequire("lamejs");
    const encoder = new Mp3Encoder(1, mp3Rate, 128);
    const a = encoder.encodeBuffer(mp3Samples); //encode mp3
    const b = encoder.flush();

    //console.log(samples);
    const out = new Int8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out.buffer;
}
