# Third-party licenses

soundSpace itself is released under the MIT License (see [LICENSE](LICENSE)).
It is built on the open-source packages below. Keep this file in sync when
dependencies change.

## Bundled into the web app

These packages are compiled into the JavaScript bundle that the browser loads.

| Package | Version | License | Copyright |
|---|---|---|---|
| [three](https://github.com/mrdoob/three.js) | 0.175.0 | MIT | © 2010-2025 three.js authors |
| [tone](https://github.com/Tonejs/Tone.js) | 15.1.22 | MIT | © 2014-2020 Yotam Mann |
| [standardized-audio-context](https://github.com/chrisguttandin/standardized-audio-context) | 25.3.77 | MIT | © 2024 Christoph Guttandin |
| [automation-events](https://github.com/chrisguttandin/automation-events) | 7.1.17 | MIT | © 2026 Christoph Guttandin |
| [@ffmpeg/ffmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) | 0.12.15 | MIT | Jerome Wu |
| [@ffmpeg/util](https://github.com/ffmpegwasm/ffmpeg.wasm) | 0.12.2 | MIT | Jerome Wu |
| [tslib](https://github.com/microsoft/tslib) | 2.8.1 | 0BSD | © Microsoft Corporation |

## Used only by the optional local server

`server.js` (the OSC relay) runs on your own machine and is not part of the web app.

| Package | Version | License | Copyright |
|---|---|---|---|
| [express](https://github.com/expressjs/express) | 5.2.1 | MIT | © 2009-2014 TJ Holowaychuk, © 2013-2014 Roman Shtylman, and contributors |
| [ws](https://github.com/websockets/ws) | 8.20.0 | MIT | © 2011 Einar Otto Stangvik, © 2013 Arnout Kazemier and contributors |

## Downloaded at runtime, not included

| Package | Version | License |
|---|---|---|
| [@ffmpeg/core](https://github.com/ffmpegwasm/ffmpeg.wasm) | 0.12.6 | GPL-2.0-or-later |

The recording feature converts captures with ffmpeg.wasm. Its core is FFmpeg
compiled to WebAssembly with libx264, and it is licensed under the GNU General
Public License v2 or later. It is not part of this repository or the built app:
the browser downloads it (about 30 MB) from unpkg.com the first time a recording
is exported. Source code is available from the ffmpeg.wasm project linked above.

## License texts

### MIT

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

### 0BSD (tslib)

> Permission to use, copy, modify, and/or distribute this software for any
> purpose with or without fee is hereby granted.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
> REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
> AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
> INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
> LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
> OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
> PERFORMANCE OF THIS SOFTWARE.
