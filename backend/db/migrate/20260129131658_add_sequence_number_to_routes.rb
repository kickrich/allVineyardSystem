class AddSequenceNumberToRoutes < ActiveRecord::Migration[8.1]
  def change
    add_column :routes, :sequence_number, :integer
  end
end
