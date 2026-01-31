import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders inline markdown tokens", () => {
    const { container, getByText } = render(
      <div>{renderMarkdown("Hello **bold** *ital* and `code` with a [link](https://example.com).")}</div>
    );

    expect(getByText("bold").tagName.toLowerCase()).toBe("strong");
    expect(getByText("ital").tagName.toLowerCase()).toBe("em");
    expect(getByText("code").tagName.toLowerCase()).toBe("code");

    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://example.com");
  });

  it("renders fenced code blocks", () => {
    const { container } = render(
      <div>{renderMarkdown("```js\nconst x = 1;\n```")}</div>
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toContain("const x = 1;");
  });
});
