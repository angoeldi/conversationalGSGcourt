import { describe, expect, it } from "vitest";
import { filterWikipediaPages, type WikiPageSummary } from "./wikipedia";

const basePage: WikiPageSummary = {
  title: "Kingdom of England",
  url: "https://en.wikipedia.org/wiki/Kingdom_of_England",
  extract: "The Kingdom of England was a sovereign state on the island of Great Britain."
};

const filmPage: WikiPageSummary = {
  title: "1492: Conquest of Paradise",
  url: "https://en.wikipedia.org/wiki/1492:_Conquest_of_Paradise",
  extract: "1492: Conquest of Paradise is a 1992 epic historical drama film."
};

const disambPage: WikiPageSummary = {
  title: "York (disambiguation)",
  url: "https://en.wikipedia.org/wiki/York_(disambiguation)",
  extract: "York may refer to multiple places, people, or ships."
};

describe("filterWikipediaPages", () => {
  it("filters media and disambiguation pages for early eras by default", () => {
    const filtered = filterWikipediaPages([basePage, filmPage, disambPage], { referenceYear: 1492 });
    expect(filtered).toEqual([basePage]);
  });

  it("allows media pages for modern eras unless explicitly disabled", () => {
    const filtered = filterWikipediaPages([basePage, filmPage], { referenceYear: 2020 });
    expect(filtered).toEqual([basePage, filmPage]);
  });

  it("respects explicit media exclusion", () => {
    const filtered = filterWikipediaPages([basePage, filmPage], { referenceYear: 2020, excludeMedia: true });
    expect(filtered).toEqual([basePage]);
  });
});
