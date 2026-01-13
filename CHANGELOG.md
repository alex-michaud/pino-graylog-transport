## [1.2.1](https://github.com/alex-michaud/pino-graylog-transport/compare/v1.2.0...v1.2.1) (2026-01-13)

### Bug Fixes

* simplify file references in package.json by including dist directory ([f1ed305](https://github.com/alex-michaud/pino-graylog-transport/commit/f1ed305a7a4af98eec6e0b6b4efa8f8fb1ba5bea))

## [1.2.0](https://github.com/alex-michaud/pino-graylog-transport/compare/v1.1.2...v1.2.0) (2026-01-12)

### Features

* add tests for getPendingWriteCount method in graylog transport ([8bcaa39](https://github.com/alex-michaud/pino-graylog-transport/commit/8bcaa391c91b0fd36480a02fdd1782c712a3a25b))
* add unit tests for flush method handling various scenarios ([4bba43f](https://github.com/alex-michaud/pino-graylog-transport/commit/4bba43f45d5d86fadb5561346688c00ef1a3dd00))
* enhance flush method to support waitForDrain option with improved message queuing ([14b9548](https://github.com/alex-michaud/pino-graylog-transport/commit/14b954815671e38a8fb929e295a3b89fc3a160f8))
* enhance socket connection management with cleanup function ([073c982](https://github.com/alex-michaud/pino-graylog-transport/commit/073c9824bae122f02c3feec892f836d173367634))
* enhance stream closing behavior with isClosing method and improved flush handling ([dae8541](https://github.com/alex-michaud/pino-graylog-transport/commit/dae85419365d62bb76edfe798e14069349145611))
* implement flush method for managing pending writes and queue drainage ([be7f678](https://github.com/alex-michaud/pino-graylog-transport/commit/be7f67800733886ebd120a7433df81cc27243763))
* implement FlushManager for efficient flush operation management and message tracking ([68149e7](https://github.com/alex-michaud/pino-graylog-transport/commit/68149e78d11ab9d9605bf002cdc7a26a410b2ec0))
* improve flush method to handle socket drain events with timeout and error handling ([76e7952](https://github.com/alex-michaud/pino-graylog-transport/commit/76e7952d90ae7480cced30a5b8e416361ef5618f))
* refactor flush method to support concurrent operations with reference counting ([7b9bdfd](https://github.com/alex-michaud/pino-graylog-transport/commit/7b9bdfdfc0237cb9a06975b2eed17a6670b348e7))
* update comparison server and benchmark scripts to include build step ([c8eb3df](https://github.com/alex-michaud/pino-graylog-transport/commit/c8eb3df0f097b20640cc13245de185e3312b3b3d))

### Documentation

* add latest benchmark results for Pino Graylog and Winston performance ([30017ec](https://github.com/alex-michaud/pino-graylog-transport/commit/30017ec54d1f8cfd499406daa166e65d4987f6f6))

## [1.1.2](https://github.com/alex-michaud/pino-graylog-transport/compare/v1.1.1...v1.1.2) (2026-01-11)

### Bug Fixes

* remove Node version check from release workflow ([0b2054a](https://github.com/alex-michaud/pino-graylog-transport/commit/0b2054a3c680eef91e4038e0a4ef8701127c185f))
* remove preinstall script for node version check ([766c48e](https://github.com/alex-michaud/pino-graylog-transport/commit/766c48e6e86e2192810ab35e318d70c8e1e632bc))

## [1.1.1](https://github.com/alex-michaud/pino-graylog-transport/compare/v1.1.0...v1.1.1) (2026-01-08)

### Bug Fixes

* remove unused dependencies "pino-abstract-transport" ([43b7f1c](https://github.com/alex-michaud/pino-graylog-transport/commit/43b7f1c61a44d9f1b2c9410dd958c16a06028aa5))

## [1.1.0](https://github.com/alex-michaud/pino-graylog-transport/compare/v1.0.2...v1.1.0) (2026-01-07)

### Features

* refactor: rename Graylog transport types for clarity ([8435617](https://github.com/alex-michaud/pino-graylog-transport/commit/84356175b22aed4b79e739b36bff2bbd1af0b398))

### Documentation

* update benchmark results for pino-graylog-transport performance ([05f0feb](https://github.com/alex-michaud/pino-graylog-transport/commit/05f0feb41c94c5d40718453580d124e04a906f1f))

## [1.0.2](https://github.com/alex-michaud/pino-graylog-transport/compare/v1.0.1...v1.0.2) (2026-01-07)

### Bug Fixes

* set package access to public ([be37b15](https://github.com/alex-michaud/pino-graylog-transport/commit/be37b159ecd05e6e51b481a85650e7392461945b))

## [1.0.1](https://github.com/alex-michaud/pino-graylog-transport/compare/v1.0.0...v1.0.1) (2026-01-07)

### Bug Fixes

* force initial release bump ([c6be6a3](https://github.com/alex-michaud/pino-graylog-transport/commit/c6be6a3d4a591475a59a4c26cb3bdac25dd733de))

## 1.0.0 (2026-01-07)

### Features

* Add UDP support to Graylog transport; enhance README with usage notes ([08c7838](https://github.com/alex-michaud/pino-graylog-transport/commit/08c783808dbc44d5c9555401d96ab5c34ecb9eab))
* Enhance UDP client initialization and message handling; update README with UDP limitations and autoConnect behavior ([8d1382b](https://github.com/alex-michaud/pino-graylog-transport/commit/8d1382bf4c55c070e14c2fd3cd871874816aa69b))
