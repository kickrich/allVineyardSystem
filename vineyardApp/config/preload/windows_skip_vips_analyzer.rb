# frozen_string_literal: true

# Active Storage's engine references ImageAnalyzer::Vips at load time, which pulls in
# ruby-vips/libvips and optional-DLL warnings on Windows stderr. Stub Vips before the
# engine loads; with variant_processor :mini_magick (default) the real Vips analyzer
# would not accept blobs anyway.
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
