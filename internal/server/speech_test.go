package server

import "testing"

func TestSpeechText(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "plain heading and list",
			in:   "## Что сделано\n\n- Добавил проверку\n- Поправил тест",
			want: "Что сделано. Добавил проверку. Поправил тест.",
		},
		{
			name: "inline code and path",
			in:   "Добавил `readFileSync` в `internal/server/tts.go`.",
			want: "Добавил read File Sync в файл tts точка go в папке internal server.",
		},
		{
			name: "bare path",
			in:   "Открой web/src/lib/api.ts и запусти bin/check.",
			want: "Открой файл api точка ts в папке web src lib и запусти bin check.",
		},
		{
			name: "url",
			in:   "Смотри https://github.com/foo/bar?x=1",
			want: "Смотри ссылка на github.com.",
		},
		{
			name: "markdown link keeps its text",
			in:   "См. [документацию](https://example.com/x).",
			want: "Смотри документацию.",
		},
		{
			name: "fenced code",
			in:   "Готово.\n\n```go\nfunc main() {\n}\n```\n",
			want: "Готово. Блок кода на Go, 2 строки.",
		},
		{
			name: "unterminated fence while streaming",
			in:   "Сейчас.\n```ts\nconst a = 1\nconst b = 2",
			want: "Сейчас. Блок кода на TypeScript, 2 строки.",
		},
		{
			name: "table",
			in:   "| a | b |\n| - | - |\n| 1 | 2 |\n\nПосле таблицы.",
			want: "Таблица: 2 колонки, 1 строка. После таблицы.",
		},
		{
			name: "percent and units",
			in:   "Готово на 50% за 2 файл и 5 коммит.",
			want: "Готово на 50 процентов за 2 файла и 5 коммитов.",
		},
		{
			name: "date and time",
			in:   "Релиз 18.11.2026 в 10:30.",
			want: "Релиз 18 ноября 2026 года в 10 30.",
		},
		{
			name: "abbreviations and number sign",
			in:   "См. задачу № 5, т.е. README.",
			want: "Смотри задачу номер 5, то есть README.",
		},
		{
			name: "version in code",
			in:   "Обнови до `v1.2.3`.",
			want: "Обнови до версия 1 точка 2 точка 3.",
		},
		{
			name: "flags and env",
			in:   "Запусти `--output_raw` и проверь `NIT_GUI_TTS`.",
			want: "Запусти флаг output raw и проверь NIT GUI TTS.",
		},
		{
			name: "long hash",
			in:   "Коммит `7c868496fe43a1b2` готов.",
			want: "Коммит хеш готов.",
		},
		{
			name: "image and emoji",
			in:   "![схема](x.png) Готово 🎉",
			want: "Готово.",
		},
		{
			name: "already plain",
			in:   "Привет, мир!",
			want: "Привет, мир!",
		},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			if got := speechText(item.in); got != item.want {
				t.Fatalf("speechText(%q)\n got %q\nwant %q", item.in, got, item.want)
			}
		})
	}
}

func TestSpeechLines(t *testing.T) {
	cases := map[int]string{
		1:  "1 строка",
		2:  "2 строки",
		5:  "5 строк",
		11: "11 строк",
		21: "21 строка",
		24: "24 строки",
	}
	for count, want := range cases {
		if got := speechLines(count); got != want {
			t.Fatalf("speechLines(%d) = %q, want %q", count, got, want)
		}
	}
}
