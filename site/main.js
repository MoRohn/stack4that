(function () {
  var liveUrl = window.LIVE_APP_URL;
  var configured = false;

  if (typeof liveUrl === "string" && liveUrl !== "TODO" && liveUrl.trim() !== "") {
    try {
      var parsed = new URL(liveUrl);
      configured = parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch (error) {
      configured = false;
    }
  }

  var links = document.querySelectorAll("[data-live-app]");
  var note = document.getElementById("live-app-url");

  if (configured) {
    links.forEach(function (link) {
      link.href = liveUrl;
      link.removeAttribute("aria-describedby");
    });
    if (note) note.hidden = true;
  }

  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");

  function setNav(open) {
    if (!nav || !toggle) return;
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Close" : "Menu";
  }

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      setNav(!nav.classList.contains("is-open"));
    });

    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        setNav(false);
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setNav(false);
    });

    document.addEventListener("click", function (event) {
      if (!nav.classList.contains("is-open")) return;
      if (nav.contains(event.target) || toggle.contains(event.target)) return;
      setNav(false);
    });
  }

  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  var copyButton = document.querySelector("[data-copy]");
  var quickstart = document.getElementById("quickstart-commands");

  if (copyButton && quickstart) {
    var copyLabel = copyButton.textContent;
    var copyTimer = 0;

    function showCopyState(message) {
      copyButton.textContent = message;
      copyButton.classList.toggle("is-copied", message === "Copied");
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(function () {
        copyButton.textContent = copyLabel;
        copyButton.classList.remove("is-copied");
      }, 2400);
    }

    function copyWithFallback(text) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "0";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (error) {
        ok = false;
      }
      document.body.removeChild(area);
      copyButton.focus();
      return ok;
    }

    copyButton.addEventListener("click", function () {
      var text = quickstart.textContent.replace(/\s+$/, "");
      if (copyWithFallback(text)) {
        showCopyState("Copied");
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () {
            showCopyState("Copied");
          },
          function () {
            showCopyState("Select the commands");
          },
        );
        return;
      }
      showCopyState("Select the commands");
    });
  }
})();
