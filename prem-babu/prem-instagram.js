const axios = require('axios');
const qs = require('qs');
const fs = require('fs');
const path = require('path');

// Ensure downloads folder exists
const downloadDir = path.resolve(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

// Download function with headers
async function downloadMedia(url, filename) {
  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': 'https://www.instagram.com/',
      },
    });

    const filePath = path.join(downloadDir, filename);
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(filePath));
      writer.on('error', reject);
    });
  } catch (err) {
    throw new Error(`Failed to download media: ${err.message}`);
  }
}

function formatPostInfo(requestData) {
  try {
    return {
      owner_username: requestData.owner.username,
      owner_fullname: requestData.owner.full_name,
      is_verified: requestData.owner.is_verified,
      is_private: requestData.owner.is_private,
      likes: requestData.edge_media_preview_like.count,
      is_ad: requestData.is_ad,
    };
  } catch (err) {
    throw new Error(`Failed to format post info: ${err.message}`);
  }
}

function formatMediaDetails(mediaData) {
  try {
    if (mediaData.is_video) {
      return {
        type: 'video',
        dimensions: mediaData.dimensions,
        video_view_count: mediaData.video_view_count,
        url: mediaData.video_url,
        thumbnail: mediaData.display_url,
      };
    } else {
      return {
        type: 'image',
        dimensions: mediaData.dimensions,
        url: mediaData.display_url,
      };
    }
  } catch (err) {
    throw new Error(`Failed to format media details: ${err.message}`);
  }
}

function getShortcode(url) {
  try {
    const split_url = url.split('/');
    const post_tags = ['p', 'reel', 'tv'];
    const index_shortcode = split_url.findIndex((item) =>
      post_tags.includes(item)
    ) + 1;
    return split_url[index_shortcode];
  } catch (err) {
    throw new Error(`Failed to obtain shortcode: ${err.message}`);
  }
}

function isSidecar(requestData) {
  try {
    return requestData['__typename'] === 'XDTGraphSidecar';
  } catch (err) {
    throw new Error(`Failed sidecar verification: ${err.message}`);
  }
}

async function instagramRequest(shortcode) {
  try {
    const BASE_URL = 'https://www.instagram.com/graphql/query';
    const INSTAGRAM_DOCUMENT_ID = '8845758582119845';
    const dataBody = qs.stringify({
      variables: JSON.stringify({
        shortcode: shortcode,
        fetch_tagged_user_count: null,
        hoisted_comment_id: null,
        hoisted_reply_id: null,
      }),
      doc_id: INSTAGRAM_DOCUMENT_ID,
    });

    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: BASE_URL,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: dataBody,
    };

    const { data } = await axios.request(config);
    if (!data.data?.xdt_shortcode_media)
      throw new Error('Only posts/reels supported, check if your link is valid.');
    return data.data.xdt_shortcode_media;
  } catch (err) {
    throw new Error(`Failed instagram request: ${err.message}`);
  }
}

async function createOutputData(requestData) {
  try {
    let url_list = [],
      media_details = [],
      downloaded_files = [];
    const IS_SIDECAR = isSidecar(requestData);

    if (IS_SIDECAR) {
      // Carousel post
      for (let i = 0; i < requestData.edge_sidecar_to_children.edges.length; i++) {
        const media = requestData.edge_sidecar_to_children.edges[i].node;
        const detail = formatMediaDetails(media);
        media_details.push(detail);
        const url = media.is_video ? media.video_url : media.display_url;
        const ext = media.is_video ? '.mp4' : '.jpg';
        const filename = `sidecar_${i + 1}${ext}`;
        const savedPath = await downloadMedia(url, filename);
        downloaded_files.push(savedPath);
        url_list.push(url);
      }
    } else {
      // Single image or video
      const detail = formatMediaDetails(requestData);
      media_details.push(detail);
      const url = requestData.is_video
        ? requestData.video_url
        : requestData.display_url;
      const ext = requestData.is_video ? '.mp4' : '.jpg';
      const filename = `media${ext}`;
      const savedPath = await downloadMedia(url, filename);
      downloaded_files.push(savedPath);
      url_list.push(url);
    }

    return {
      results_number: url_list.length,
      url_list,
      downloaded_files,
      post_info: formatPostInfo(requestData),
      media_details,
    };
  } catch (err) {
    throw new Error(`Failed to create output data: ${err.message}`);
  }
}

module.exports = prem_instagram = (url_media) => {
  return new Promise(async (resolve, reject) => {
    try {
      const SHORTCODE = getShortcode(url_media);
      const INSTAGRAM_REQUEST = await instagramRequest(SHORTCODE);
      const OUTPUT_DATA = await createOutputData(INSTAGRAM_REQUEST);
      resolve(OUTPUT_DATA);
    } catch (err) {
      reject({
        error: err.message,
      });
    }
  });
};
