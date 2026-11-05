import assert from "node:assert/strict";
import test from "node:test";
import { UI_LANGUAGES, TRANSLATIONS, resolveLanguage, translate } from "./i18n.mjs";

test("Auto negotiates five browser languages with region variants and an explicit English fallback", () => {
  for (const [browser, expected] of [["en-GB", "en"], ["zh-CN", "zh"], ["zh-TW", "zh"], ["de-DE", "de"], ["ja-JP", "ja"], ["ko-KR", "ko"]]) {
    assert.equal(resolveLanguage("auto", [browser]), expected);
  }
  assert.equal(resolveLanguage("auto", ["fr-FR", "ja-JP"]), "ja");
  assert.equal(resolveLanguage("auto", ["fr-FR"]), "en");
  assert.equal(resolveLanguage("auto", []), "en");
  assert.equal(resolveLanguage("de", ["zh-CN"]), "de");
  assert.throws(() => resolveLanguage("fr"));
});

test("every message has complete nonempty translations with identical interpolation parameters", () => {
  assert.ok(Object.keys(TRANSLATIONS).length > 250);
  const params = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [key, values] of Object.entries(TRANSLATIONS)) {
    assert.equal(values.length, UI_LANGUAGES.length - 1, key);
    for (const value of values) {
      assert.equal(typeof value, "string", key);
      assert.ok(value.trim().length > 0, key);
      assert.deepEqual(params(value), params(key), key);
    }
  }
});

test("controls, dynamic status, navigation and accessibility messages use each locale", () => {
  for (const locale of UI_LANGUAGES) {
    for (const key of ["Climate", "Music", "Navigation", "Phone & contacts", "Connect voice agent", "Previous track", "Next track"]) {
      const actual = translate(key, {}, locale);
      assert.ok(actual);
      if (locale !== "en" && key !== "Navigation" && key !== "Music") assert.notEqual(actual, key);
    }
    assert.ok(translate("{count} / 8 stops saved · no route or ETA", { count: 3 }, locale).includes("3"));
    assert.ok(translate("Edit stop {number}", { number: 2 }, locale).includes("2"));
    assert.ok(!translate("Lower {door} window", { door: "test" }, locale).includes("{"));
  }
  assert.throws(() => translate("Edit stop {number}", {}, "zh"), /Missing translation parameter/);
  assert.throws(() => translate("Climate", {}, "fr"));
});

test("external text and identifiers are not translated or interpreted as templates", () => {
  for (const locale of UI_LANGUAGES) {
    assert.equal(translate("Alex Chen", {}, locale), "Alex Chen");
    assert.equal(translate("user file {private}.wav", {}, locale), "user file {private}.wav");
    assert.equal(translate("set_climate", {}, locale), "set_climate");
  }
});
