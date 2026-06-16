# frozen_string_literal: true

# Active Storage's engine defaults include ImageAnalyzer::Vips; resolving that constant
# loads ruby-vips/libvips, which on Windows prints optional-DLL noise to the real stderr
# (Ruby's STDERR wrapper cannot intercept it). Defining Vips before the engine runs avoids
# loading the real analyzer while variant_processor stays :mini_magick (ImageMagick wins).
require "active_support"
require "active_support/notifications"
require "active_record"
require "active_storage"
require "active_storage/analyzer"
require "active_storage/analyzer/image_analyzer"

stub = Class.new(ActiveStorage::Analyzer::ImageAnalyzer) do
  def self.accept?(_blob) = false
end

ActiveStorage::Analyzer::ImageAnalyzer.const_set(:Vips, stub)
