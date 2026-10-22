# 英语词卡音频维护

为英语牌组今天及接下来六天的新词生成独立背面 MP3，每词朗读一次，使用已采用的默认英音、词性和用法指导。多音词的音频对应默认读音。播放沿用牌组的 `audioAutoplay` 设置，生成和导入不修改该设置。

## 选择与生成

脚本按牌组时区、日切点、每天新词额度和卡片 ID 升序选择；纳入今天首次学习的卡片，并扣除已使用的新词额度。日期是预计学习批次，不修改到期时间。已有背面音频的卡片不覆盖，未通过默认英音核验的词不生成。

先创建计划，不调用模型。以下目录只作示例，其他批次使用新目录：

```sh
python3 server/scripts/prepare-english-audio.py \
  --db server/data/flashnext.db --deck-id 9 --days 7 \
  --output server/scripts/data/english-audio/batch
```

同一目录会复用冻结计划及其哈希，不随学习进度扩大范围。词条、音标、词性、已采用发音或卡片正文发生变化时拒绝复用。添加 `--generate` 才调用付费模型：

```sh
python3 server/scripts/prepare-english-audio.py \
  --db server/data/flashnext.db --deck-id 9 --days 7 \
  --output server/scripts/data/english-audio/batch \
  --generate --workers 2 --group-size 1
```

`--limit 25` 可先试跑前 25 个词；去掉该参数继续完整计划。`--group-size 4` 可合并请求，仅在检测到精确数量的长停顿时切分，每个片段独立检查；边界不确定时回退逐词生成。

## 网关与读音检查

通过 `https://chat.rethinkos.com` 的 Bifrost 原生 `generateContent` 透传调用已配置的 Gemini provider。凭据只从项目 `.env` 的 `LLM_API_KEY` 读取，不进入计划、日志或媒体。声音固定为 Kore，依次使用三个已授权模型：

- `gemini-3.8-flash-tts`
- `gemini-3.1-flash-tts-preview`
- `gemini-3.8-flash-lite-tts`

3.8 使用词面正文及 `speech_metadata.style`，3.1 使用其旧版请求格式。每条证据记录实际使用的模型和切换原因。配额按模型分别处理；全部模型每日额度耗尽时保存恢复时刻并退出，返回码为 75。生成词数不等于请求数，失败重试和其他任务也会消耗额度。

先使用 `gemini/lite` 盲转写，不提供预期词面或音标；不匹配时再用 `gemini/gemini-3.8-flash` 转写。仅规范大小写、首尾标点和空白，不合并词形。通过转写后，独立检查词音完整、英音兼容、目标重音和单次朗读，四项均明确通过才可采用。置信度为 medium 时，额外要求盲音标转写与目标音标对应；不降低重音或音素标准。

词典明确支持的同音词或分词差异见 [识别例外](../server/scripts/resources/english-audio-recognition-aliases.json)，逐条绑定词面和目标音标；原始转写及词典依据保留。针对特定目标读音的提示见 [发音提示](../server/scripts/resources/english-audio-pronunciation-guidance.json)。这些资源属于可复用校订，应提交 Git。

自动检查不等于人工审音或权威认证，产物记录 `phoneticCertified: false`。未通过的词标为 `needs_review`，禁止导入。原始 WAV、最终 MP3、哈希、切分位置、模型证据及进度全部保存在被 Git 忽略的批次目录。

## 导入、验证与续跑

先对数据库及媒体副本预演：

```sh
python3 server/scripts/import-english-audio.py \
  --db /path/to/db-copy --batch server/scripts/data/english-audio/batch \
  --media-dir /path/to/media-copy --report /path/to/preview.json
```

默认不写入；应用需 `--apply --backup <新的备份路径>`。`--ready-only` 显式选择已通过项，完整导入则要求计划内每个目标词通过检查。导入重新核对身份、音标、卡片正文和文件字节，只允许写媒体表，保留已有背面附件；不修改学习状态、词条、设置或其他语言的音频。导入报告和来源日志用于核查及按批次回滚。

生产应用前暂停写入，导入后在恢复服务前运行 `verify-english-audio.py`，逐表核对备份中的非媒体数据及原有媒体，检查 MP3 哈希、关联、外键和完整性。数据库备份不包含媒体文件，恢复时需要同时保留两者。恢复学习后不要用整库备份覆盖后续学习记录。

续跑器先等待保存的配额恢复时间，再生成完整批次；全部通过后先验证副本，然后短暂停止容器、正式导入、核查并恢复服务，最后验证 Web 实际播放。生成检查失败则不进入正式导入，保留现有音频和错误记录。续跑需要宿主机 Python、ffmpeg/ffprobe、Docker、可非交互执行导入命令的 sudo，以及 Node 和浏览器测试依赖：

```sh
python3 server/scripts/resume-english-audio.py \
  --db /absolute/path/flashnext.db \
  --batch /absolute/path/batch \
  --media-dir /absolute/path/media \
  --backup-dir /absolute/path/data-backup \
  --verification /absolute/path/batch/completion-production-verification.json \
  --node-bin /absolute/path/node
```

默认容器为 `flashnext`，服务地址为 `http://127.0.0.1:9000`，可用 `--container`、`--base-url` 调整。批次的 `continuation.json` 记录状态，只有生产与播放检查均通过才标为 `complete`。脚本不安装定时任务，需要后台运行时另行交给进程管理器。

## 验证代码

```sh
python3 server/scripts/tests/english-audio.py
python3 server/scripts/tests/english-audio-resume.py
python3 server/scripts/tests/japanese-audio.py
python3 server/scripts/tests/japanese-audio-resume.py
```

这些测试使用临时数据库、模拟网关及本地音频，不调用付费模型。覆盖范围选择、严格读音检查、缓存身份、仅媒体写入、重复导入、回滚、续跑顺序和日语兼容性。

实际 Web 检查使用只读队列替换，不提交评分：

```sh
node server/scripts/tests/english-audio-browser.cjs \
  http://127.0.0.1:9000 /absolute/path/batch/applied-import.json
```

浏览器报告由调用方保存在批次目录，不提交 Git。音频生成与导入在宿主机运行，无需重建 Web 或 App。
