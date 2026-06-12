class ApplicationController < ActionController::Base
  include Pagy::Method
  # Only allow modern browsers supporting webp images, web push, badges, import maps, CSS nesting, and CSS :has.
  allow_browser versions: :modern

  # Changes to the importmap will invalidate the etag for HTML responses
  stale_when_importmap_changes

  helper_method :app_base_path, :app_path

  # url_for / video_path не добавляют /vineyard за nginx — задаём префикс явно.
  def app_base_path
    Rails.application.config.relative_url_root.to_s.chomp("/")
  end

  def app_path(path)
    base = app_base_path
    return path.to_s if base.blank?

    path = path.to_s
    path = path.sub(/\A#{Regexp.escape(base)}(?=\/|\z)/, "")
    path = "/#{path.delete_prefix("/")}"
    "#{base}#{path}"
  end
end
