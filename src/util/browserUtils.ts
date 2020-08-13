export function downloadArrayBuffer(data: ArrayBuffer, type: string, name: string) {
	const blobURL = URL.createObjectURL(new Blob([data], {type: type}));
	downloadURL(blobURL, type, name);
	URL.revokeObjectURL(blobURL);
}

export function downloadURL(url: string, type: string, name: string) {
	const link = document.createElement("a");
	link.download = name;
	link.href = url;
	link.click();
	link.remove();
}