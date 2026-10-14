# Third-party notices

SageCut itself is MIT licensed (see LICENSE). This file lists the third-party files that SageCut ships. The full licence texts are in `bin/licenses/` (written by `npm run build`).

## Shipped files that are not ours

| Component | Version | Licence | Copyright | Where it is in SageCut |
|---|---|---|---|---|
| tesseract.js | 7.0.0 | Apache-2.0 | tesseract.js contributors (naptha/tesseract.js) | Bundled in `bin/sagecut.mjs`; worker script bundled in `bin/ocr/worker.cjs` |
| tesseract.js-core (Tesseract OCR compiled to WebAssembly) | 7.0.0 | Apache-2.0 | antimatter15 and tesseract.js-core contributors; contains the Tesseract OCR engine (Google and the Tesseract authors, Apache-2.0) and Leptonica (Dan Bloomberg, BSD-2-Clause), as set out by the upstream package | `bin/ocr/tesseract-core-lstm.wasm`, `tesseract-core-simd-lstm.wasm`, `tesseract-core-relaxedsimd-lstm.wasm`, and the glue code inside `bin/ocr/worker.cjs` |
| tessdata_fast `eng.traineddata` | main branch, downloaded 2026-10-13 | Apache-2.0 | The Tesseract OCR authors (tesseract-ocr/tessdata_fast) | `assets/eng.traineddata` |
| yaml | 2.9.1 | ISC | Copyright Eemeli Aro | Bundled in `bin/sagecut.mjs` |
| regenerator-runtime | 0.13.11 | MIT | Copyright (c) 2014-present, Facebook, Inc. | Bundled in `bin/ocr/worker.cjs` |
| wasm-feature-detect | 1.9.0 | Apache-2.0 | Copyright 2017 Google Inc. | Bundled in `bin/ocr/worker.cjs` |
| node-fetch | 2.7.0 | MIT | Copyright (c) 2016 David Frank | Bundled with tesseract.js |
| whatwg-url | 5.0.0 | MIT | Copyright (c) 2015-2016 Sebastian Mayr | Bundled with node-fetch |
| tr46 | 0.0.3 | MIT | Copyright (c) Sebastian Mayr (package author) | Bundled with whatwg-url. The npm package has no licence file; the MIT text is below |
| webidl-conversions | 3.0.1 | BSD-2-Clause | Copyright (c) 2014, Domenic Denicola | Bundled with whatwg-url |
| bmp-js | 0.1.0 | MIT | Copyright (c) 2014 shaozilee | Bundled with tesseract.js |
| is-url | 1.2.4 | MIT | The package has no copyright line; see `bin/licenses/is-url.LICENSE.txt` | Bundled with tesseract.js |

The build tool esbuild (MIT) and the compiler helpers it adds are not copied into the shipped files except for small runtime stubs. Node.js built-in modules are not shipped.

`bin/licenses/` holds the licence text of every package that esbuild inlined (the build reads the esbuild metafile, so the list stays correct) and the licence of the tessdata_fast data.

## tr46 licence text (MIT)

Copyright (c) Sebastian Mayr

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
