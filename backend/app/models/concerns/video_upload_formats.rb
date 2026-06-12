# frozen_string_literal: true

module VideoUploadFormats
  ALLOWED_VIDEO_CONTENT_TYPES = %w[
    video/mp4
    video/webm
    video/quicktime
    video/x-msvideo
    video/x-matroska
  ].freeze

  ALLOWED_VIDEO_EXTENSIONS = %w[.mp4 .webm .mov .avi .mkv].freeze

  module_function

  def content_type_for_extension(ext)
    case ext.to_s.downcase
    when ".mp4" then "video/mp4"
    when ".webm" then "video/webm"
    when ".mov" then "video/quicktime"
    when ".avi" then "video/x-msvideo"
    when ".mkv" then "video/x-matroska"
    end
  end

  def allowed_video?(content_type:, path: nil)
    return true if content_type.present? && ALLOWED_VIDEO_CONTENT_TYPES.include?(content_type.to_s)

    ext = File.extname(path.to_s).downcase
    ALLOWED_VIDEO_EXTENSIONS.include?(ext)
  end
end
