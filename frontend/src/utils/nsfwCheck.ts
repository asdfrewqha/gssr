import * as nsfwjs from 'nsfwjs'

let model: nsfwjs.NSFWJS | null = null

async function getModel(): Promise<nsfwjs.NSFWJS> {
  if (!model) {
    model = await nsfwjs.load()
  }
  return model
}

const NSFW_CLASSES = ['Porn', 'Hentai', 'Sexy']
const NSFW_THRESHOLD = 0.7

/**
 * Returns true if the image is likely NSFW.
 * @param imgElement - An HTMLImageElement to classify
 */
export async function isNSFW(imgElement: HTMLImageElement): Promise<boolean> {
  const m = await getModel()
  const predictions = await m.classify(imgElement)
  const nsfwScore = predictions
    .filter((p) => NSFW_CLASSES.includes(p.className))
    .reduce((sum, p) => sum + p.probability, 0)
  return nsfwScore > NSFW_THRESHOLD
}
