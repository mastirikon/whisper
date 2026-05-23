# Урок 1. `tempfile` против собственной папки `upload/`

## Где боль

В первой версии `transcribe`-роута мы делали так:

```python
dir_path: Path = current_app.config["UPLOAD_FOLDER"]
dir_path.mkdir(parents=True, exist_ok=True)
file_path: Path = dir_path / safe_name

file.save(file_path)
try:
    result = whisper.speech_to_text(file_path)
    return {"text": result.get("text")}, 200
except Exception:
    logger.exception("transcription failed")
    return {"error": "transcription failed"}, 500
finally:
    file_path.unlink(missing_ok=True)
```

Что здесь не так:

1. **Ручная уборка** — `mkdir`, потом `unlink` в `finally`. Любая ошибка между ними рискует оставить мусор.
2. **Папка `upload/`** в репозитории — она не должна там быть, в неё ничего не должно «жить дольше запроса».
3. **Коллизия имён** — если два запроса принесут файл с одинаковым `safe_name`, второй перетрёт первый.
4. **Гонка между gunicorn-воркерами** — если когда-нибудь добавим cleanup на старте процесса, два воркера могут наступить друг на друга.

В общем: «scratch-файл» (нужен только в рамках одного запроса) обёрнут в инфраструктуру «постоянного хранилища».

## Идея

В стандартной библиотеке Python для таких файлов есть выделенный модуль — `tempfile`. Он:

- кладёт файлы в системную temp-директорию (`/tmp` на Linux, `/var/folders/.../T/` на macOS);
- сам генерирует уникальное имя — никаких коллизий;
- сама ОС регулярно чистит `/tmp/` — даже если процесс убили, мусор не накопится;
- через **контекстный менеджер** гарантирует удаление файла после выхода из блока.

## Контекстный менеджер `with` — что это

Аналог `using` в C# и `try-with-resources` в Java. Для Node.js-разработчика самая близкая модель — это «`finally`, который написал за тебя сам объект».

Когда выполнение **любым** способом покидает `with`-блок (нормальный `return`, `raise`, прокинутое исключение), Python вызывает у объекта метод `__exit__`. У `NamedTemporaryFile(delete=True)` `__exit__` удаляет файл.

То есть `with` — это не просто «открыл/закрыл», это контракт «гарантирую очистку ресурса». Им оборачивают:
- файлы (`open(...)`);
- блокировки (`threading.Lock`);
- соединения с БД (`connection.cursor()`);
- временные ресурсы (`tempfile.NamedTemporaryFile`, `tempfile.TemporaryDirectory`).

## Как стало в нашем коде

`backend/app/routes/transcribe.py`:

```python
import os
import tempfile

# ...
suffix = os.path.splitext(filename)[1]

with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
    file.save(tmp.name)
    try:
        result = speech_to_text(tmp.name, model=current_app.config["WHISPER_MODEL"])
        return jsonify({"text": result.get("text", "")}), 200
    except Exception:
        logger.exception("transcription failed")
        return jsonify({"error": "transcription failed"}), 500
```

Что мы потеряли:
- `mkdir` (папка `/tmp` уже есть);
- `safe_name`/`secure_filename` (имя теперь генерирует ОС, инъекции невозможны);
- `finally` с `unlink` (этим занимается `with`);
- ключ `UPLOAD_FOLDER` из `config.py`;
- саму папку `upload/`.

Что приобрели:
- невозможность коллизий имён;
- гарантию очистки даже при падении процесса (ОС подметёт `/tmp/`);
- одну точку ответственности за «временный файл».

## Параметры `NamedTemporaryFile`

| Параметр | Что делает |
| --- | --- |
| `suffix=".m4a"` | расширение в имени — нужно, чтобы whisper/ffmpeg правильно понял формат |
| `prefix="..."` | префикс имени, по умолчанию `tmp` |
| `dir="..."` | куда класть, по умолчанию системная temp-дира |
| `delete=True` | удалить ли при выходе из `with` (по умолчанию `True`) |
| `delete_on_close=False` | новое в Python 3.12 — отделить «закрыть файловый дескриптор» от «удалить файл» |

## Нюанс с Windows

Исторически до Python 3.12 на Windows `NamedTemporaryFile` нельзя было повторно открыть для чтения, пока он держится контекстным менеджером (Windows не любит, когда два процесса держат один файл). Решения:

- Python 3.12+: использовать `delete_on_close=False` — закроем дескриптор, потом отдадим whisper'у путь, потом сами удалим.
- Старый трюк: `delete=False` + ручной `os.unlink(tmp.name)` в `finally`.

У нас сервер на Linux — этого можно не делать, `delete=True` работает прозрачно.

## Параллель с Node.js

В Express ты бы написал примерно так:

```js
import { file as tmpFile } from "tmp-promise";

app.post("/transcribe", upload.single("audio"), async (req, res) => {
  const { path, cleanup } = await tmpFile({ postfix: ".m4a" });
  try {
    await fs.promises.rename(req.file.path, path);
    const text = await whisper(path);
    res.json({ text });
  } finally {
    await cleanup();
  }
});
```

То есть Node-эквивалент `with tempfile.NamedTemporaryFile()` — это пакет `tmp` (или `tmp-promise`) с явным `cleanup()`. В Python инфраструктура встроена в стандартную библиотеку и оборачивается синтаксисом `with`.

## Эвристика на будущее

Если в коде накапливается «механизм ручной уборки» — `mkdir` тут, `unlink` там, `cleanup` в `finally`, флаг «надо ли удалять» — почти всегда это сигнал «выбран не тот инструмент». Контекстный менеджер `with` — главное оружие против такой россыпи.

Когда видишь `try/finally` где `finally` только что-то освобождает — поищи, есть ли объект, который умеет в `__enter__/__exit__` (открой `with ...` вместо).
