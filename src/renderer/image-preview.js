const previewImage = document.getElementById("previewImage");
const imagePath = document.getElementById("imagePath");

function renderImage(payload) {
  previewImage.src = payload?.dataUrl || "";
  imagePath.textContent = payload?.filePath || "";
}

window.aimini.onPreviewImageUpdated(renderImage);
window.aimini.getPreviewImage().then(renderImage);
