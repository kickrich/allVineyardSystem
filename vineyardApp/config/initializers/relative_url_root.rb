# frozen_string_literal: true

# nginx отдаёт в Puma пути без /vineyard; префикс нужен только для url_for / link_to / assets.
root = ENV["RAILS_RELATIVE_URL_ROOT"].presence
Rails.application.config.relative_url_root = root if root
