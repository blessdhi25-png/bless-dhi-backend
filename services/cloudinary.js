const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isVideo = file.mimetype.startsWith('video/');
    return {
      folder:         'bless_dhi_hostels',
      resource_type:  isVideo ? 'video' : 'image',
      allowed_formats: [
        'jpg','jpeg','png','gif',
        'mp4','avi','mkv','mov','webm'
      ],
      transformation: isVideo ? [] : [
        { width: 1200, height: 800,
          crop: 'limit', quality: 'auto' }
      ],
    };
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

module.exports = { cloudinary, upload };