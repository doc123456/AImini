const selection = document.getElementById("selection");
const screenPreview = document.getElementById("screenPreview");

let startX = 0;
let startY = 0;
let selecting = false;

window.aimini.getCapturePreview().then((dataUrl) => {
  if (dataUrl) {
    screenPreview.src = dataUrl;
  }
});

function renderSelection(currentX, currentY) {
  const x = Math.min(startX, currentX);
  const y = Math.min(startY, currentY);
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);
  selection.hidden = false;
  selection.style.left = `${x}px`;
  selection.style.top = `${y}px`;
  selection.style.width = `${width}px`;
  selection.style.height = `${height}px`;
}

window.addEventListener("mousedown", (event) => {
  selecting = true;
  startX = event.clientX;
  startY = event.clientY;
  renderSelection(startX, startY);
});

window.addEventListener("mousemove", (event) => {
  if (!selecting) return;
  renderSelection(event.clientX, event.clientY);
});

window.addEventListener("mouseup", (event) => {
  if (!selecting) return;
  selecting = false;
  const x = Math.min(startX, event.clientX);
  const y = Math.min(startY, event.clientY);
  const width = Math.abs(event.clientX - startX);
  const height = Math.abs(event.clientY - startY);

  if (width < 8 || height < 8) {
    window.aimini.cancelCaptureArea();
    return;
  }

  window.aimini.selectCaptureArea({ x, y, width, height });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.aimini.cancelCaptureArea();
  }
});
